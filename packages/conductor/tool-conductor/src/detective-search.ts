/** Detective-only discovery tools with source-sized pages and durable continuations. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { isAbsolute, normalize, sep } from 'node:path'
import type { ConductorRunId } from '@deepseek-ai/dsh-conductor'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import {
  buildGlobCommand, buildGrepCommand, GLOB_MAX_RESULTS, GREP_MAX_LINE_BYTES, GREP_MAX_MATCHES,
  parseGlobArgs, parseGrepArgs, parseGrepMatches, previewLine, RAW_OUTPUT_MAX_BYTES, runRipgrep,
  sampleAcrossTopLevel, SEARCH_GRACE_MS, SEARCH_STDERR_MAX_BYTES, SEARCH_TIMEOUT_MS, toWorkdirRelative,
} from '@deepseek-ai/dsh-tool-fs-search'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import {
  MIN_DETECTIVE_SEARCH_RESULT_CHARS, parseDetectiveSearchCursor, renderDetectiveSearchPage,
} from './detective-search-page.ts'
import type { DetectiveSearchKind } from './detective-search-page.ts'
import { DetectiveSearchSnapshotStore } from './detective-search-snapshot.ts'
import type { DetectiveSearchReference, DetectiveSearchSnapshot } from './detective-search-snapshot.ts'

/** Detective-specific process and entry limits, independent of other roles. */
export interface DetectiveSearchExecutionConfig {
  /** Prefer one path from each top-level entry before remaining glob paths. */
  readonly sampleOverCapGlobResults?: boolean
  /** Maximum complete paths in one glob page (default 100). */
  readonly globMaxResults?: number
  /** Maximum complete matches in one grep page (default 250). */
  readonly grepMaxMatches?: number
  /** Maximum UTF-8 bytes in one explicitly cropped matched-line preview (default 2000). */
  readonly grepMaxLineBytes?: number
  /** Maximum retained complete ripgrep stdout bytes (default 20000000). */
  readonly rawOutputMaxBytes?: number
  /** Grace period before terminating a cancelled search process (default 3000 ms). */
  readonly graceMs?: number
  /** Maximum retained stderr bytes (default 65536). */
  readonly stderrMaxBytes?: number
  /** Cooperative per-call timeout, including persistence (default 30000 ms). */
  readonly timeoutMs?: number
}

function positive(defaultValue: number) {
  return z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(defaultValue)
}

const executionConfig = z.object({
  sampleOverCapGlobResults: z.boolean().default(true),
  globMaxResults: positive(GLOB_MAX_RESULTS),
  grepMaxMatches: positive(GREP_MAX_MATCHES),
  grepMaxLineBytes: positive(GREP_MAX_LINE_BYTES),
  rawOutputMaxBytes: positive(RAW_OUTPUT_MAX_BYTES),
  graceMs: positive(SEARCH_GRACE_MS).max(MAX_TIMER_DELAY_MS),
  stderrMaxBytes: positive(SEARCH_STDERR_MAX_BYTES),
  timeoutMs: positive(SEARCH_TIMEOUT_MS).max(MAX_TIMER_DELAY_MS),
})

/** Configuration owned by the Detective search contribution. */
export interface DetectiveSearchSettings {
  /** Maximum characters in a complete Detective glob result (default 4000). */
  readonly detectiveGlobMaxResultChars?: number
  /** Maximum characters in a complete Detective grep result (default 4000). */
  readonly detectiveGrepMaxResultChars?: number
  /** Private artifact directory; defaults to storages/conductor-search under DSH_HOME. */
  readonly detectiveSearchSnapshotRoot?: string
  /** Maximum complete saved artifact bytes, including ownership (default 40000000). */
  readonly detectiveSearchSnapshotMaxBytes?: number
  /** Role-specific entry, preview and process settings; defaults follow the search tools. */
  readonly detectiveSearch?: DetectiveSearchExecutionConfig
}

/** Field schemas shared by Loader configuration and direct apply validation. */
export const detectiveSearchConfigFields = {
  detectiveGlobMaxResultChars: positive(4_000).min(MIN_DETECTIVE_SEARCH_RESULT_CHARS),
  detectiveGrepMaxResultChars: positive(4_000).min(MIN_DETECTIVE_SEARCH_RESULT_CHARS),
  detectiveSearchSnapshotRoot: z.string(),
  detectiveSearchSnapshotMaxBytes: positive(2 * RAW_OUTPUT_MAX_BYTES),
  detectiveSearch: executionConfig.default(new executionConfig({})),
}

const settingsConfig = z.object(detectiveSearchConfigFields)

/** Resolved host policy retained by one trusted child installer. */
export interface DetectiveSearchPolicy {
  readonly globMaxChars: number
  readonly grepMaxChars: number
  readonly execution: Required<DetectiveSearchExecutionConfig>
  readonly store: DetectiveSearchSnapshotStore
}

/**
 * Resolve and validate Detective search policy without opening its storage.
 * @param settings - deployment configuration, also accepted by direct apply callers.
 * @returns resolved limits and a side-effect-free snapshot-store handle.
 * @throws on invalid limits or a non-absolute artifact root.
 */
export function resolveDetectiveSearchPolicy(settings: DetectiveSearchSettings): DetectiveSearchPolicy {
  const parsed = new settingsConfig(settings) as Required<Omit<DetectiveSearchSettings, 'detectiveSearchSnapshotRoot' | 'detectiveSearch'>>
    & Pick<DetectiveSearchSettings, 'detectiveSearchSnapshotRoot'> & { detectiveSearch: Required<DetectiveSearchExecutionConfig> }
  const root = parsed.detectiveSearchSnapshotRoot ?? dshHomePath('storages', 'conductor-search')
  if (!isAbsolute(root)) throw new TypeError('detectiveSearchSnapshotRoot must be an absolute path')
  return {
    globMaxChars: parsed.detectiveGlobMaxResultChars,
    grepMaxChars: parsed.detectiveGrepMaxResultChars,
    execution: parsed.detectiveSearch,
    store: new DetectiveSearchSnapshotStore(root, parsed.detectiveSearchSnapshotMaxBytes),
  }
}

interface SearchArgs {
  readonly pattern?: string
  readonly path?: string
  readonly include?: string
  readonly cursor?: string
}

function portablePath(path: string): string {
  return path.split(sep).join('/')
}

function breadthFirstPaths(paths: string[], root: string): string[] {
  if (paths.length === 0) return paths
  const groups = sampleAcrossTopLevel(paths, 1, root).total
  const first = sampleAcrossTopLevel(paths, groups, root).items
  const selected = new Set(first)
  return [...first, ...paths.filter(path => !selected.has(path))]
}

async function discover(
  ctx: Context, exec: ToolRunContext, kind: DetectiveSearchKind, args: SearchArgs, policy: DetectiveSearchPolicy,
): Promise<DetectiveSearchSnapshot> {
  if (args.pattern === undefined) throw new Error('Provide a search pattern, or only a saved page cursor')
  if (kind === 'glob' && args.include !== undefined) throw new Error('glob does not accept include')
  const query = kind === 'glob' ? parseGlobArgs({ ...args, pattern: args.pattern }) : parseGrepArgs({ ...args, pattern: args.pattern })
  const argv = kind === 'glob' ? buildGlobCommand(query) : buildGrepCommand(query)
  const caps = policy.execution
  const result = await runRipgrep(ctx, exec, kind, argv, caps.rawOutputMaxBytes, caps.graceMs, caps.stderrMaxBytes)
  let entries: string[]
  if (kind === 'glob') {
    const paths = result.noMatches ? [] : result.stdout.split('\n').filter(line => line.length > 0)
      .map(path => normalize(toWorkdirRelative(path, result.workdir)))
    const root = normalize(toWorkdirRelative(query.path ?? '.', result.workdir))
    const ordered = caps.sampleOverCapGlobResults ? breadthFirstPaths(paths, root) : paths
    entries = ordered.map(portablePath)
  } else {
    entries = result.noMatches ? [] : parseGrepMatches(result.stdout).map(match =>
      `${portablePath(toWorkdirRelative(match.path, result.workdir))}:${match.lineNumber}: ${previewLine(match.line, caps.grepMaxLineBytes)}`)
  }
  return { kind, query, entries }
}

function searchTool(ctx: Context, runId: ConductorRunId, kind: DetectiveSearchKind, policy: DetectiveSearchPolicy): ToolDefinition {
  const maxChars = kind === 'glob' ? policy.globMaxChars : policy.grepMaxChars
  return defineTool({
    name: kind,
    description: `Read-only ${kind} search returning at most ${maxChars} characters including counts and continuation. `
      + 'Start with pattern and optional path; continue with only the returned cursor. '
      + 'A cursor reads the saved result, even if workspace files change. Unreturned entries are not inspected. '
      + (kind === 'glob' && policy.execution.sampleOverCapGlobResults
        ? 'One path per top-level entry precedes the remaining paths.' : 'Entries retain search order.'),
    parameters: {
      pattern: { type: 'string', description: kind === 'glob' ? 'File glob pattern for a new search.' : 'Ripgrep regular expression for a new search.' },
      path: { type: 'string', description: 'Search target relative to the session workspace, or an absolute target.' },
      ...kind === 'grep' ? { include: { type: 'string' as const, description: 'One positive file glob filter for a new grep search.' } } : {},
      cursor: { type: 'string', description: 'Exact saved continuation; supply no other argument with it.' },
    },
    timeoutMs: policy.execution.timeoutMs,
    output: { schema: { type: 'string' }, render: (_args, value) => {
      if (Array.from(value).length > maxChars) throw new Error('Detective search canonical output exceeds its result limit')
      return [{ type: 'text', text: value }]
    } },
    async execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('Detective search requires its producing child agent')
      const owner = { runId, childId: agent.session.id }
      let snapshot: DetectiveSearchSnapshot
      let reference: DetectiveSearchReference
      let offset = 0
      if (args.cursor === undefined) {
        snapshot = await discover(ctx, exec, kind, args, policy)
        reference = await policy.store.save(owner, snapshot, exec.signal)
      } else {
        if (Object.keys(args).length !== 1) throw new Error('A search continuation accepts only cursor')
        const parsed = parseDetectiveSearchCursor(args.cursor)
        offset = parsed.offset
        reference = parsed
        snapshot = await policy.store.load(owner, reference, kind, exec.signal)
        if (offset >= snapshot.entries.length) throw new Error('Detective search cursor is outside its saved result')
      }
      return renderDetectiveSearchPage({ kind, ...reference, entries: snapshot.entries, offset, maxChars,
        maxItems: kind === 'glob' ? policy.execution.globMaxResults : policy.execution.grepMaxMatches }).text
    },
    finalizeContent: (_exec, result) => {
      const size = result.content.reduce((total, block) => total + Array.from(block.type === 'text' ? block.text : JSON.stringify(block)).length, 0)
      return size <= maxChars ? undefined : [{ type: 'text', text:
        'Search output exceeded its result limit and was omitted. Narrow the query or report this failure; do not treat the omitted output as inspected.' }]
    },
    presentCall: args => ({ card: 'generic', kind: 'search',
      title: args.cursor === undefined ? `Detective ${kind}` : `Next ${kind} page`, rawInput: args.pattern ?? args.cursor }),
  })
}

/**
 * Install Detective-owned search shadows without changing other roles or prior history.
 * @param ctx - host-owned search execution services.
 * @param runId - the admitted run identity.
 * @param policy - validated source and storage limits.
 * @returns an unpublished-child installer and its combined disposer.
 */
export function detectiveSearchContribution(
  ctx: Context, runId: ConductorRunId, policy: DetectiveSearchPolicy,
): SubagentChildToolContribution {
  return (childCtx) => {
    const stops: Array<() => void> = []
    const dispose = () => { for (const stop of stops.toReversed()) stop() }
    try {
      for (const [kind, order] of [['glob', 103], ['grep', 104]] as const) {
        stops.push(childCtx.tools.register(searchTool(ctx, runId, kind, policy)))
        stops.push(childCtx.systemPrompt.section({ name: `tool:${kind}`, order,
          text: `Use ${kind} for read-only discovery. Results are bounded pages from a saved search snapshot. `
            + 'Follow its cursor to inspect later entries; do not claim that omitted entries were inspected. '
            + 'A truncated line preview requires read for full surrounding source. Search discoveries are not admitted material or verified citations.' }))
      }
      return dispose
    } catch (error) {
      dispose()
      throw error
    }
  }
}
