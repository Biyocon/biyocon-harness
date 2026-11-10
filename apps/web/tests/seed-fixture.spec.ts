import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { realizeSeedFixture } from './scaffold.ts'

describe('web seed fixture paths', () => {
  it.each([
    String.raw`C:\Users\synthetic\workspace`,
    String.raw`C:\test\quoted "folder"\workspace`,
    String.raw`\\server\share\workspace`,
    '/tmp/synthetic/workspace',
  ])('realizes the recorded seed as valid JSONL for %s', async (workspaceCwd) => {
    const fixture = await readFile(new URL('./snapshots/seeded-history/seed.jsonl', import.meta.url), 'utf8')
    const realized = realizeSeedFixture({ workspaceCwd }, fixture, 'synthetic-session')
    const records: unknown[] = realized.trim().split('\n').map(line => JSON.parse(line) as unknown)
    expect(records[0]).toMatchObject({ type: 'session', id: 'synthetic-session', cwd: workspaceCwd })
    expect(realized).not.toContain('{{cwd}}')
    expect(realized).not.toContain('{{sessionId}}')
    expect(realized).toContain(JSON.stringify(`<path>${workspaceCwd}/a.txt</path>`).slice(1, -1))
    expect(realizeSeedFixture({ workspaceCwd }, realized, 'synthetic-session')).toBe(realized)
  })

  it('rewrites an escaped recorded path in the header and event text', () => {
    const recordedCwd = String.raw`D:\recorded\quoted "folder"`
    const workspaceCwd = String.raw`C:\synthetic\new workspace`
    const fixture = [
      { type: 'session', cwd: recordedCwd },
      { type: 'tool/result', text: `${recordedCwd}/file.txt` },
    ].map(record => JSON.stringify(record)).join('\n') + '\n'
    const realized = realizeSeedFixture({ workspaceCwd }, fixture, 'synthetic-session')
    expect(realized.split('\n').filter(Boolean).map(line => JSON.parse(line) as unknown)).toEqual([
      { type: 'session', cwd: workspaceCwd },
      { type: 'tool/result', text: `${workspaceCwd}/file.txt` },
    ])
    expect(realizeSeedFixture({ workspaceCwd }, realized, 'synthetic-session')).toBe(realized)
  })

  it('keeps a header without cwd and escapes the substituted session id', () => {
    const id = 'synthetic-"quoted"-session'
    const fixture = '{"type":"session","id":"{{sessionId}}"}\n'
    expect(JSON.parse(realizeSeedFixture({ workspaceCwd: '/tmp/test' }, fixture, id))).toEqual({ type: 'session', id })
  })

  it('rejects malformed header JSON rather than repairing it', () => {
    expect(() => realizeSeedFixture({ workspaceCwd: '/tmp/test' }, '{invalid}\n', 'synthetic')).toThrow(SyntaxError)
  })
})
