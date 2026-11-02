/** Assembled headless workflow snapshot for a host-reserved child identity. */

import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders, type NormalizeContext } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import { describe, expect, it } from 'vitest'

const expectedPath = fileURLToPath(new URL('./reserved-child-identity-snapshots/child.expected.jsonl', import.meta.url))
const configPath = fileURLToPath(new URL('../reserved-child-identity.cordis.snapshot.yml', import.meta.url))
const binScript = fileURLToPath(new URL('./fixtures/reserved-child-identity-driver.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const refreshing = process.env.DSH_SNAPSHOT === 'refresh'

describe('reserved workflow child identity snapshot', () => {
  it('logs the actual child id in the host-composed model prompt', async () => {
    let observedChildId: string | undefined
    const result = await runLoaderSmoke({
      label: 'reserved workflow child identity headless snapshot',
      tempDirPrefix: 'dsh-reserved-child-',
      binScript,
      libBinScript: binScript,
      configPath,
      binArgs: [configPath],
      tsconfigPath,
      inspect: async (cwd) => {
        const sessionsDir = join(cwd, '.sessions')
        const files = (await readdir(sessionsDir, { recursive: true })).filter(file => file.endsWith('.jsonl'))
        const logs = await Promise.all(files.map(async file => readFile(join(sessionsDir, file), 'utf8')))
        const child = logs.find((content) => {
          const header = JSON.parse(content.split('\n')[0] ?? '{}') as Record<string, unknown>
          return header.parentSession === 'reserved-identity-parent'
        })
        if (child === undefined) throw new Error('missing persisted workflow child session')
        const header = JSON.parse(child.split('\n')[0] ?? '{}') as Record<string, unknown>
        if (typeof header.id !== 'string') throw new Error('workflow child has no persisted session id')
        observedChildId = header.id
        const events = child.trimEnd().split('\n').slice(1)
          .map(line => JSON.parse(line) as { type?: string; data?: { content?: Array<{ type?: string; text?: string }> } })
        const userText = events.flatMap(event => event.type === 'user/message'
          ? event.data?.content?.flatMap(block => block.type === 'text' ? [block.text] : []) ?? []
          : [])
        expect(userText).toContain(`identify the child. Confirm the session identity using the following metadata.\nactual-child-id:${observedChildId}`)

        const context: NormalizeContext = { sessionIds: [observedChildId], cwd }
        const normalized = scrubRequestHeaders(normalizeSessionLog(child, context))
        if (refreshing) {
          await mkdir(dirname(expectedPath), { recursive: true })
          await writeFile(expectedPath, normalized)
        }
        expect(normalized).toBe(await readFile(expectedPath, 'utf8'))
      },
    })

    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout.trim()) as Record<string, unknown>).toEqual({
      type: 'result', childId: observedChildId, value: 'IDENTIFIED',
    })
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
