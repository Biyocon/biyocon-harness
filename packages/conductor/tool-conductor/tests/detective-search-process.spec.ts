import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { expect, it } from 'vitest'

function text(result: ToolExecutionResult): string {
  return result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
}

it('reads original pages in fresh processes and rejects foreign or missing storage without searching again', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-detective-process-'))
  const cwd = join(root, 'workspace')
  const store = join(root, 'private-search')
  await mkdir(cwd)
  await writeFile(join(cwd, 'evidence.txt'), 'NEEDLE first\nNEEDLE middle\nNEEDLE original-last\n')
  const run = async (args: Record<string, string>, childId = 'process-child', storage = store): Promise<ToolExecutionResult> => {
    const result = await execa(process.execPath, ['--import', 'tsx/esm',
      fileURLToPath(new URL('./fixtures/detective-search-process.ts', import.meta.url)),
      cwd, storage, childId, JSON.stringify(args)], {
      env: { TSX_TSCONFIG_PATH: resolve('tsconfig.json'), DSH_HOME: join(root, 'unused-home'),
        DSH_AGENTS_HOME: join(root, 'unused-agents') }, timeout: 15_000,
    })
    expect(result.stderr).toBe('')
    return JSON.parse(result.stdout) as ToolExecutionResult
  }
  const first = await run({ pattern: 'NEEDLE', path: 'evidence.txt' })
  expect(first.isError).toBe(false)
  expect(text(first)).toContain('evidence.txt:1: NEEDLE first')
  const cursor = /"cursor":"([^"]+)"/.exec(text(first))?.[1]
  if (cursor === undefined) throw new Error('Expected a continuation after the first process exits')
  await writeFile(join(cwd, 'evidence.txt'), 'EXTERNAL_REPLACEMENT\n')
  const second = await run({ cursor })
  expect(second.isError).toBe(false)
  expect(text(second)).toContain('evidence.txt:2: NEEDLE middle')
  expect(text(second)).not.toContain('EXTERNAL_REPLACEMENT')
  const next = /"cursor":"([^"]+)"/.exec(text(second))?.[1]
  if (next === undefined) throw new Error('Expected a final continuation')
  const third = await run({ cursor: next })
  expect(third.isError).toBe(false)
  expect(text(third)).toContain('evidence.txt:3: NEEDLE original-last')
  expect(text(third)).toContain('Truncated: false.')
  for (const result of [await run({ cursor }, 'another-child'), await run({ cursor }, 'process-child', join(root, 'missing-store'))]) {
    expect(result.isError).toBe(true)
    expect(text(result)).not.toContain('Showing 0 of 0 entries')
    expect(text(result)).not.toContain('Next page:')
  }
}, 30_000)
