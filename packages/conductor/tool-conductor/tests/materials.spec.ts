import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import { contentHash } from '@deepseek-ai/dsh-conductor'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { captureMaterials } from '../src/materials.ts'

const contexts: Context[] = []
const directories: string[] = []
const signal = new AbortController().signal
const limits = { maxMaterialFiles: 2, maxMaterialBytes: 1024, maxMaterialTotalBytes: 4096 }
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
  for (const path of directories.splice(0)) {
    if (!path.startsWith(join(tmpdir(), 'conductor-material-test-'))) throw new Error('Unexpected test directory')
    await rm(path, { recursive: true, force: true })
  }
})

async function setup(text = 'Assess `plan.md` without modifying it.', filesystem = true) {
  const root = await mkdtemp(join(tmpdir(), 'conductor-material-test-'))
  directories.push(root)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  await writeFile(join(cwd, 'plan.md'), 'A bounded supplied plan.\n')
  await writeFile(join(cwd, 'unrelated-dirty.txt'), 'LOCAL DATA MUST NOT BE SCANNED\n')
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SessionStore)
  if (filesystem) await ctx.plugin(LocalFileSystem)
  const session = ctx.sessions.create(SessionId('material-parent'), { meta: { cwd } })
  const message = (value: string, user = true) => session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: value }], source: user ? { kind: 'user' } : { kind: 'plugin', plugin: 'test' },
  }), { surfaceOp: 'append' })
  if (text) message(text)
  const parent = { session } as unknown as Agent
  const capture = (files: string[], policy = limits) => captureMaterials(ctx, parent, files, policy, signal)
  return { ctx, cwd, root, parent, message, capture }
}

describe('Conductor bounded material capture', () => {
  it('captures the actual user message and only its cited file through the filesystem service', async () => {
    const h = await setup()
    h.message('Plugin text is not the owner task.', false)
    const read = vi.spyOn(h.ctx.fs, 'readBytes')
    const captured = await h.capture(['plan.md'])
    expect(captured).toMatchObject([
      { selector: 'current-request', content: 'Assess `plan.md` without modifying it.', sourceMessage: { sessionId: 'material-parent', eventIndex: 0 } },
      { selector: 'plan.md', kind: 'file', content: 'A bounded supplied plan.\n', sha256: contentHash('A bounded supplied plan.\n') },
    ])
    expect(captured[1]!.id).toMatch(/^material-[a-f0-9]{64}$/)
    expect(read).toHaveBeenCalledTimes(1)
    expect(await readFile(join(h.cwd, 'unrelated-dirty.txt'), 'utf8')).toBe('LOCAL DATA MUST NOT BE SCANNED\n')
  })

  it('accepts a literal absolute citation but retains only the workspace-relative selector', async () => {
    const h = await setup()
    h.message(`Assess "${join(h.cwd, 'plan.md')}".`)
    expect((await h.capture(['plan.md']))[1]!.selector).toBe('plan.md')
  })

  it('requires an actual user message and does not read files without a workspace filesystem', async () => {
    const h = await setup('', false)
    await expect(h.capture([])).rejects.toThrow(/actual current user message/)
    h.message('plan.md')
    expect(await h.capture([])).toHaveLength(1)
    await expect(h.capture(['plan.md'])).rejects.toThrow(/filesystem and workspace/)
  })

  it('rejects attachment admission instead of silently discarding non-text owner input', async () => {
    const h = await setup()
    h.parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [{
      type: 'image', attachment: { attachmentId: 'fixture-image' as never, mediaType: 'image/png', bytes: 1, width: 1, height: 1 },
    }] }), { surfaceOp: 'append' })
    await expect(h.capture([])).rejects.toThrow(/attachment admission is not supported/)
  })

  it.each(['../secret', '/outside.md', 'C:/secret', 'sub\\plan.md', './plan.md', 'sub//plan.md', ''])('rejects non-normalized selector %s', async (path) => {
    const h = await setup()
    await expect(h.capture([path])).rejects.toThrow(/workspace-relative/)
  })

  it('rejects uncited paths, directories, missing files and symlink escapes', async () => {
    const h = await setup('Read plan.md, missing.md, directory, escape/secret.md.')
    await expect(h.capture(['invented.md'])).rejects.toThrow(/not explicitly cited/)
    await expect(h.capture(['missing.md'])).rejects.toThrow(/accessible regular file/)
    await mkdir(join(h.cwd, 'directory'))
    await expect(h.capture(['directory'])).rejects.toThrow(/accessible regular file/)
    const outside = join(h.root, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'secret.md'), 'must not be captured')
    await symlink(outside, join(h.cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir')
    const read = vi.spyOn(h.ctx.fs, 'readBytes')
    await expect(h.capture(['escape/secret.md'])).rejects.toThrow(/escapes the workspace/)
    expect(read).not.toHaveBeenCalled()
  })

  it('rejects content substitution during capture instead of hashing the replacement', async () => {
    const h = await setup()
    const read = h.ctx.fs.readBytes.bind(h.ctx.fs)
    vi.spyOn(h.ctx.fs, 'readBytes').mockImplementation(async (...args) => {
      const bytes = await read(...args)
      await writeFile(join(h.cwd, 'plan.md'), 'Substituted content with a different size.')
      return bytes
    })
    await expect(h.capture(['plan.md'])).rejects.toThrow(/changed while being captured/)
  })

  it('enforces count and complete-input byte limits, including serialized metadata', async () => {
    const h = await setup()
    await expect(h.capture(['plan.md', 'plan.md'])).rejects.toThrow(/duplicates/)
    await expect(h.capture(['plan.md'], { ...limits, maxMaterialFiles: 0 })).rejects.toThrow(/file count/)
    await expect(h.capture([], { ...limits, maxMaterialBytes: 2 })).rejects.toThrow(/user message exceeds/)
    await expect(h.capture([], { ...limits, maxMaterialTotalBytes: 2 })).rejects.toThrow(/maxMaterialTotalBytes/)
    await writeFile(join(h.cwd, 'plan.md'), 'x'.repeat(2048))
    await expect(h.capture(['plan.md'])).rejects.toThrow(/limit|exceed|large/i)
  })

  it.each([Buffer.from([0xff]), Buffer.from('a\0b')])('rejects non-UTF8 or binary material', async (bytes) => {
    const h = await setup()
    await writeFile(join(h.cwd, 'plan.md'), bytes)
    await expect(h.capture(['plan.md'])).rejects.toThrow(/encoded|UTF-8/i)
  })
})
