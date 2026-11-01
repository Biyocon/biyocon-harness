import * as fs from 'node:fs/promises'
import * as win32 from '@deepseek-ai/dsh-fs-local/src/win32.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { syncConductorSkills } from '../scripts/generate-conductor-skills.ts'

vi.mock('node:fs/promises', async importOriginal => ({ ...await importOriginal<typeof fs>() }))

vi.mock('@deepseek-ai/dsh-fs-local/src/win32.ts', async importOriginal => ({ ...await importOriginal<typeof win32>() }))

function publicationSpy() {
  return process.platform === 'win32' ? vi.spyOn(win32, 'replaceFileWin32') : vi.spyOn(fs, 'rename')
}

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'dsh-conductor-assets-'))
  roots.push(root)
  const source = join(root, '.agents')
  const destination = join(root, 'preset/skills')
  for (const dir of ['conductor/roles', 'conductor/templates', 'skills/conductor-specialist']) {
    await fs.mkdir(join(source, dir), { recursive: true })
  }
  await fs.writeFile(join(source, 'conductor/README.md'), 'shared old')
  await fs.writeFile(join(source, 'conductor/roles/detective.md'), 'role old')
  await fs.writeFile(join(source, 'skills/conductor-specialist/SKILL.md'), 'protocol old')
  return { root, source, destination, sync: () => syncConductorSkills(source, destination) }
}

describe('Conductor resource publication', () => {
  it('publishes a complete initial tree and performs no filesystem mutations for identical bytes', async () => {
    const f = await fixture()
    await f.sync()
    expect(await fs.readFile(join(f.destination, 'roles/detective.md'), 'utf8')).toBe('role old')
    const mutations = ['mkdir', 'mkdtemp', 'writeFile', 'rename', 'unlink', 'rm'] as const
    const spies = mutations.map(name => vi.spyOn(fs, name))
    await f.sync()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it('keeps unchanged files untouched and removes obsolete files after publication', async () => {
    const f = await fixture()
    await f.sync()
    const unchanged = join(f.destination, 'README.md')
    const before = await fs.stat(unchanged)
    await fs.writeFile(join(f.destination, 'obsolete.md'), 'obsolete')
    await fs.writeFile(join(f.source, 'conductor/roles/detective.md'), 'role new')
    const rename = publicationSpy()
    const unlink = vi.spyOn(fs, 'unlink')
    await f.sync()
    expect((await fs.stat(unchanged)).mtimeMs).toBe(before.mtimeMs)
    expect(rename).toHaveBeenCalledTimes(1)
    expect(unlink.mock.invocationCallOrder[0]).toBeGreaterThan(rename.mock.invocationCallOrder[0]!)
    expect(await fs.readdir(f.destination)).not.toContain('obsolete.md')
  })

  it.each([false, true])('preserves a case-only renamed resource with changed bytes: %s', async (changeBytes) => {
    const f = await fixture()
    await f.sync()
    const next = join(f.source, 'conductor/roles/Detective.md')
    await fs.rename(join(f.source, 'conductor/roles/detective.md'), next)
    if (changeBytes) await fs.writeFile(next, 'role new')
    await f.sync()
    expect(await fs.readFile(join(f.destination, 'roles/Detective.md'), 'utf8')).toBe(changeBytes ? 'role new' : 'role old')
    const mutations = ['mkdir', 'mkdtemp', 'writeFile', 'rename', 'unlink', 'rm', 'chmod'] as const
    const spies = mutations.map(name => vi.spyOn(fs, name))
    await f.sync()
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
  })

  it.skipIf(process.platform === 'win32')('preserves parent directory access permissions for initial POSIX publication', async () => {
    const f = await fixture()
    await f.sync()
    expect((await fs.stat(f.destination)).mode & 0o777).toBe((await fs.stat(join(f.root, 'preset'))).mode & 0o777)
  })

  it('lets an open reader finish old bytes while new readers see complete replacements', async () => {
    const f = await fixture()
    await f.sync()
    const target = join(f.destination, 'roles/detective.md')
    const oldReader = await fs.open(target, 'r')
    const next = 'new role\n'.repeat(65_536)
    await fs.writeFile(join(f.source, 'conductor/roles/detective.md'), next)
    await fs.writeFile(join(f.destination, 'obsolete.md'), 'remove last')
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const original = process.platform === 'win32' ? win32.replaceFileWin32 : fs.rename
    publicationSpy().mockImplementation(async (from, to) => {
      entered.resolve(undefined)
      await release.promise
      await original(from, to)
    })
    const publishing = f.sync()
    try {
      await entered.promise
      expect(await fs.readFile(target, 'utf8')).toBe('role old')
      expect(await fs.readFile(join(f.destination, 'README.md'), 'utf8')).toBe('shared old')
      expect(await fs.readFile(join(f.destination, 'obsolete.md'), 'utf8')).toBe('remove last')
      release.resolve(undefined)
      await publishing
      expect(await oldReader.readFile('utf8')).toBe('role old')
      expect(await fs.readFile(target, 'utf8')).toBe(next)
    } finally {
      release.resolve(undefined)
      await publishing
      await oldReader.close()
    }
  })

  it.each(['initial', 'update'] as const)('coordinates two overlapping %s publications without retries', async (kind) => {
    const f = await fixture()
    if (kind === 'update') await f.sync()
    await fs.writeFile(join(f.source, 'conductor/roles/detective.md'), 'shared new generation')
    const bothStaged = Promise.withResolvers<undefined>()
    let arrivals = 0
    const original = kind === 'initial' || process.platform !== 'win32' ? fs.rename : win32.replaceFileWin32
    const spy = kind === 'initial' ? vi.spyOn(fs, 'rename') : publicationSpy()
    spy.mockImplementation(async (from, to) => {
      if (++arrivals === 2) bothStaged.resolve(undefined)
      await bothStaged.promise
      await original(from, to)
    })
    await Promise.all([f.sync(), f.sync()])
    expect(await fs.readFile(join(f.destination, 'roles/detective.md'), 'utf8')).toBe('shared new generation')
    expect(await fs.readdir(join(f.root, 'preset'))).toEqual(['skills'])
  })

  it('accepts a concurrent new-file publication while its winner has an open reader', async () => {
    const f = await fixture()
    await f.sync()
    await fs.writeFile(join(f.source, 'conductor/templates/added.md'), 'new shared file')
    const target = join(f.destination, 'templates/added.md')
    const bothStaged = Promise.withResolvers<undefined>()
    const firstPublished = Promise.withResolvers<undefined>()
    const originalRename = fs.rename
    let arrivals = 0
    let reader: Awaited<ReturnType<typeof fs.open>> | undefined
    const rename = vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      const position = ++arrivals
      if (position === 2) bothStaged.resolve(undefined)
      await bothStaged.promise
      if (position === 1) {
        await originalRename(from, to)
        reader = await fs.open(target, 'r')
        firstPublished.resolve(undefined)
      } else {
        await firstPublished.promise
        await originalRename(from, to)
      }
    })
    try {
      await Promise.all([f.sync(), f.sync()])
      expect(rename).toHaveBeenCalledTimes(2)
      expect(await fs.readFile(target, 'utf8')).toBe('new shared file')
      expect(await reader!.readFile('utf8')).toBe('new shared file')
    } finally {
      await reader?.close()
    }
  })

  it('does not accept a different concurrent creation as successful publication', async () => {
    const f = await fixture()
    await f.sync()
    await fs.writeFile(join(f.source, 'conductor/templates/added.md'), 'expected bytes')
    const target = join(f.destination, 'templates/added.md')
    const rename = vi.spyOn(fs, 'rename').mockImplementationOnce(async () => {
      await fs.writeFile(target, 'other bytes')
      throw Object.assign(new Error('competing file'), { code: 'EPERM' })
    })
    await expect(f.sync()).rejects.toThrow('competing file')
    expect(rename).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(target, 'utf8')).toBe('other bytes')
  })

  it.each(['file-to-directory', 'directory-to-file'] as const)('rejects %s conflicts before mutating active files', async (kind) => {
    const f = await fixture()
    const sourcePath = join(f.source, 'conductor/templates/item')
    if (kind === 'directory-to-file') {
      await fs.mkdir(sourcePath)
      await fs.writeFile(join(sourcePath, 'old.md'), 'old resource')
    } else await fs.writeFile(sourcePath, 'old resource')
    await f.sync()
    await fs.rm(sourcePath, { recursive: true })
    if (kind === 'file-to-directory') {
      await fs.mkdir(sourcePath)
      await fs.writeFile(join(sourcePath, 'new.md'), 'new resource')
    } else await fs.writeFile(sourcePath, 'new resource')
    await fs.writeFile(join(f.source, 'conductor/README.md'), 'shared new')
    const mutations = ['mkdir', 'mkdtemp', 'writeFile', 'rename', 'unlink', 'rm'] as const
    const spies = mutations.map(name => vi.spyOn(fs, name))
    await expect(f.sync()).rejects.toThrow(`The generated skills directory ${f.destination} is ignored by git and can be removed safely; it will be rebuilt on the next launch.`)
    for (const spy of spies) expect(spy).not.toHaveBeenCalled()
    expect(await fs.readFile(join(f.destination, 'README.md'), 'utf8')).toBe('shared old')
  })

  it('leaves active files and obsolete files intact when staging fails', async () => {
    const f = await fixture()
    await f.sync()
    await fs.writeFile(join(f.source, 'conductor/README.md'), 'shared new')
    await fs.writeFile(join(f.destination, 'obsolete.md'), 'keep on failure')
    vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('staging disk failure'))
    await expect(f.sync()).rejects.toThrow('staging disk failure')
    expect(await fs.readFile(join(f.destination, 'README.md'), 'utf8')).toBe('shared old')
    expect(await fs.readFile(join(f.destination, 'obsolete.md'), 'utf8')).toBe('keep on failure')
  })

  it('fails a blocked rename once without unlinking the active file', async () => {
    const f = await fixture()
    await f.sync()
    await fs.writeFile(join(f.source, 'conductor/roles/detective.md'), 'new role')
    const rename = publicationSpy().mockRejectedValueOnce(Object.assign(new Error('locked file'), { code: 'EPERM' }))
    await expect(f.sync()).rejects.toThrow('locked file')
    expect(rename).toHaveBeenCalledTimes(1)
    expect(await fs.readFile(join(f.destination, 'roles/detective.md'), 'utf8')).toBe('role old')
  })
})
