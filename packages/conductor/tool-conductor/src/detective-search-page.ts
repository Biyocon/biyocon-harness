/** Bounded Detective search pages over one immutable search snapshot. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** SHA-256 identity of a saved search snapshot. */
export type DetectiveSearchDigest = Branded<'DetectiveSearchDigest'>

/** A model-facing continuation bound to one saved search snapshot. */
export type DetectiveSearchCursor = Branded<'DetectiveSearchCursor'>

/** Random private artifact identity, scoped to the producing child session. */
export type DetectiveSearchSnapshotId = Branded<'DetectiveSearchSnapshotId'>

/** The read-only search operation that owns a snapshot. */
export type DetectiveSearchKind = 'glob' | 'grep'

/** Validated per-result and per-page limits. */
export interface DetectiveSearchPageLimits {
  /** Maximum Unicode characters in the complete rendered result. */
  readonly maxChars: number
  /** Maximum complete entries in one page. */
  readonly maxItems: number
}

/** Immutable source and position for one page. */
export interface DetectiveSearchPageInput extends DetectiveSearchPageLimits {
  readonly kind: DetectiveSearchKind
  readonly snapshotId: DetectiveSearchSnapshotId
  readonly digest: DetectiveSearchDigest
  readonly entries: readonly string[]
  readonly offset: number
}

/** Internal page facts; only text is returned to a model. */
export interface DetectiveSearchPage {
  readonly text: string
  readonly shown: number
  readonly total: number
  readonly nextCursor?: DetectiveSearchCursor
}

function characters(text: string): number {
  return Array.from(text).length
}

function cursor(snapshotId: DetectiveSearchSnapshotId, digest: DetectiveSearchDigest, offset: number): DetectiveSearchCursor {
  return `${snapshotId}:${digest}:${offset}` as DetectiveSearchCursor
}

function page(
  kind: DetectiveSearchKind,
  snapshotId: DetectiveSearchSnapshotId,
  digest: DetectiveSearchDigest,
  entries: readonly string[],
  offset: number,
  end: number,
): DetectiveSearchPage {
  const shown = end - offset
  const total = entries.length
  const nextCursor = end < total ? cursor(snapshotId, digest, end) : undefined
  const range = shown === 0 ? 'none' : `${offset + 1}-${end}`
  const header = `${kind} search snapshot: ${digest}\nShowing ${shown} of ${total} entries (range ${range}).`
    + `\nTruncated: ${nextCursor !== undefined}.`
    + (nextCursor === undefined ? '' : `\nNext page: ${kind}({"cursor":"${nextCursor}"})`)
  const body = entries.slice(offset, end).join('\n')
  return { text: body.length === 0 ? header : `${header}\n\n${body}`, shown, total,
    ...nextCursor === undefined ? {} : { nextCursor } }
}

/** Protocol minimum accommodating the longest safe-integer header and cursor plus one character. */
export const MIN_DETECTIVE_SEARCH_RESULT_CHARS = characters(
  `grep search snapshot: ${'f'.repeat(64)}\nShowing ${Number.MAX_SAFE_INTEGER} of ${Number.MAX_SAFE_INTEGER}`
  + ` entries (range ${Number.MAX_SAFE_INTEGER}-${Number.MAX_SAFE_INTEGER}).\nTruncated: true.`
  + `\nNext page: grep({"cursor":"${'f'.repeat(36)}:${'f'.repeat(64)}:${Number.MAX_SAFE_INTEGER}"})\n\n`,
) + 1

/**
 * Validate the deployment's resolved page limits before tool installation.
 * @param limits - resolved character and entry limits.
 * @throws when a limit is unsafe or cannot carry the complete page framing.
 */
export function assertDetectiveSearchPageLimits(limits: DetectiveSearchPageLimits): void {
  for (const [name, value] of [['maxChars', limits.maxChars], ['maxItems', limits.maxItems]] as const) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive safe integer`)
  }
  if (limits.maxChars < MIN_DETECTIVE_SEARCH_RESULT_CHARS) {
    throw new TypeError(`maxChars must be at least ${MIN_DETECTIVE_SEARCH_RESULT_CHARS} to include search page metadata`)
  }
}

/**
 * Decode a model-supplied continuation; no path is accepted in a cursor.
 * @param value - the exact cursor returned by a previous page.
 * @returns the snapshot digest and positive entry offset.
 * @throws for malformed cursors or offsets outside the safe-integer range.
 */
export function parseDetectiveSearchCursor(value: string): {
  snapshotId: DetectiveSearchSnapshotId
  digest: DetectiveSearchDigest
  offset: number
} {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}:[a-f0-9]{64}:[1-9][0-9]*$/.test(value)) {
    throw new Error('Invalid Detective search cursor')
  }
  const offset = Number(value.slice(102))
  if (!Number.isSafeInteger(offset)) throw new Error('Invalid Detective search cursor offset')
  return { snapshotId: value.slice(0, 36) as DetectiveSearchSnapshotId,
    digest: value.slice(37, 101) as DetectiveSearchDigest, offset }
}

/**
 * Render complete entries within both limits, including all page metadata.
 * @param input - a validated snapshot position and resolved limits.
 * @returns the bounded page and its next cursor, without rewriting earlier pages.
 * @throws when one entry cannot fit; no partial entry is presented as inspected.
 */
export function renderDetectiveSearchPage(input: DetectiveSearchPageInput): DetectiveSearchPage {
  const { kind, snapshotId, digest, entries, offset, maxChars, maxItems } = input
  const last = Math.min(entries.length, offset + maxItems)
  const final = page(kind, snapshotId, digest, entries, offset, last)
  if (characters(final.text) <= maxChars) return final
  let accepted: DetectiveSearchPage | undefined
  for (let end = offset + 1; end <= last; end += 1) {
    const candidate = page(kind, snapshotId, digest, entries, offset, end)
    if (characters(candidate.text) > maxChars) break
    accepted = candidate
  }
  if (accepted === undefined) {
    throw new Error(`Detective ${kind} entry ${offset + 1} cannot fit the result limit; narrow the query or increase the configured limit`)
  }
  return accepted
}
