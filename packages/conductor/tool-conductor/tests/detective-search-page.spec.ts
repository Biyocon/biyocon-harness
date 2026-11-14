import { describe, expect, it } from 'vitest'
import {
  assertDetectiveSearchPageLimits,
  MIN_DETECTIVE_SEARCH_RESULT_CHARS,
  parseDetectiveSearchCursor,
  renderDetectiveSearchPage,
} from '../src/detective-search-page.ts'
import type { DetectiveSearchDigest, DetectiveSearchPageInput, DetectiveSearchSnapshotId } from '../src/detective-search-page.ts'

const digest = 'a'.repeat(64) as DetectiveSearchDigest
const snapshotId = '11111111-1111-4111-8111-111111111111' as DetectiveSearchSnapshotId
const input = (overrides: Partial<DetectiveSearchPageInput> = {}): DetectiveSearchPageInput => ({
  kind: 'glob', snapshotId, digest, entries: ['src/a.ts', 'test/a.spec.ts'], offset: 0, maxChars: 4_000, maxItems: 100,
  ...overrides,
})

describe('Detective search page limits', () => {
  it('accepts the framing minimum and rejects limits below it', () => {
    expect(() =>{  assertDetectiveSearchPageLimits({ maxChars: MIN_DETECTIVE_SEARCH_RESULT_CHARS, maxItems: 1 }) }).not.toThrow()
    expect(() =>{  assertDetectiveSearchPageLimits({ maxChars: MIN_DETECTIVE_SEARCH_RESULT_CHARS - 1, maxItems: 1 }) })
      .toThrow('include search page metadata')
  })

  it('validates only the declared limits in a larger resolved configuration', () => {
    const resolved = { maxChars: 4_000, maxItems: 100, snapshotRoot: '/owned/snapshots' }
    expect(() =>{  assertDetectiveSearchPageLimits(resolved) }).not.toThrow()
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid character and entry limits: %s', (value) => {
      expect(() =>{  assertDetectiveSearchPageLimits({ maxChars: value, maxItems: 1 }) }).toThrow('maxChars')
      expect(() =>{  assertDetectiveSearchPageLimits({ maxChars: 4_000, maxItems: value }) }).toThrow('maxItems')
    },
  )
})

describe('Detective search cursor', () => {
  it('round-trips the exact snapshot identity and position', () => {
    expect(parseDetectiveSearchCursor(`${snapshotId}:${digest}:12`)).toEqual({ snapshotId, digest, offset: 12 })
  })

  it.each(['', '../snapshot:1', `${snapshotId}:${digest}:0`, `${snapshotId}:${digest}:-1`, `${snapshotId}:${digest}:1.5`,
    `${snapshotId}:${digest}:01`, `${snapshotId}:${digest}:9007199254740992`, `${snapshotId}:${digest.toUpperCase()}:1`,
    `${snapshotId}:${digest}:1\n`])('rejects malformed cursor %j', (value) => {
    expect(() => parseDetectiveSearchCursor(value)).toThrow('Invalid Detective search cursor')
  })
})

describe('Detective search pages', () => {
  it('returns an explicitly complete empty result', () => {
    const result = renderDetectiveSearchPage(input({ entries: [] }))
    expect(result).toMatchObject({ shown: 0, total: 0 })
    expect(result.text).toContain('range none')
    expect(result.text).toContain('Truncated: false')
    expect(result.nextCursor).toBeUndefined()
  })

  it('preserves every entry and its path/line identity when the result fits', () => {
    const entries = ['src/a.ts:19: first match', 'src/b.ts:7: later adverse finding']
    const result = renderDetectiveSearchPage(input({ kind: 'grep', entries }))
    expect(result.text).toContain(entries.join('\n'))
    expect(result.text).toContain('Showing 2 of 2 entries (range 1-2)')
    expect(result.nextCursor).toBeUndefined()
  })

  it('pages without gaps or repeated entries under the character limit', () => {
    const entries = Array.from({ length: 15 }, (_, index) => `${index}: ${'x'.repeat(600)}`)
    let offset = 0
    const seen: string[] = []
    do {
      const result = renderDetectiveSearchPage(input({ entries, offset }))
      expect(Array.from(result.text).length).toBeLessThanOrEqual(4_000)
      const lines = result.text.split('\n\n')[1]?.split('\n') ?? []
      seen.push(...lines)
      if (result.nextCursor === undefined) break
      const next = parseDetectiveSearchCursor(result.nextCursor)
      expect(next.digest).toBe(digest)
      expect(next.offset).toBeGreaterThan(offset)
      offset = next.offset
    } while (offset < entries.length)
    expect(seen).toEqual(entries)
  })

  it('retains an independent item cap when short entries fit the character cap', () => {
    const result = renderDetectiveSearchPage(input({ maxItems: 1 }))
    expect(result.shown).toBe(1)
    expect(result.total).toBe(2)
    expect(result.text).toContain('Truncated: true')
    expect(result.text).toContain(`glob({"cursor":"${snapshotId}:${digest}:1"})`)
  })

  it('counts Unicode characters without cutting a surrogate pair', () => {
    const entries = Array.from({ length: 9 }, (_, index) => `${index}: ${'🧭'.repeat(600)}`)
    const result = renderDetectiveSearchPage(input({ entries }))
    expect(Array.from(result.text).length).toBeLessThanOrEqual(4_000)
    expect(result.text).toContain(entries[0])
    expect(result.shown).toBeGreaterThan(1)
    expect(result.text.endsWith('\ud83e')).toBe(false)
  })

  it('accepts an exact complete-result limit and includes framing in the bound', () => {
    const entries = ['x'.repeat(MIN_DETECTIVE_SEARCH_RESULT_CHARS)]
    const complete = renderDetectiveSearchPage(input({ entries }))
    expect(renderDetectiveSearchPage(input({ entries, maxChars: Array.from(complete.text).length }))).toEqual(complete)
    expect(() => renderDetectiveSearchPage(input({ entries: ['x'.repeat(4_000)] }))).toThrow('cannot fit the result limit')
  })

  it('keeps a smaller final header from forcing an unnecessary continuation', () => {
    const entries = ['x'.repeat(250), 'y']
    const complete = renderDetectiveSearchPage(input({ entries }))
    const result = renderDetectiveSearchPage(input({ entries, maxChars: Array.from(complete.text).length }))
    expect(result.shown).toBe(2)
    expect(result.nextCursor).toBeUndefined()
  })
})
