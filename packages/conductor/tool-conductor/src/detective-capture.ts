/** Detective-only indexed admission and bounded reads from the saved intake capture. */
import z from '@deepseek-ai/schemastery'
import { captureIntakeMaterial } from '@deepseek-ai/dsh-conductor'
import type { ConductorAdmission, IntakeMaterial } from '@deepseek-ai/dsh-conductor'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DETECTIVE_CAPTURE_READ_TOOL } from './capability.ts'

/** Deployment limits for the Detective's saved-source reader. */
export interface DetectiveCaptureSettings {
  /** Complete result character limit, including metadata (default 4000, minimum 512). */
  readonly detectiveCaptureMaxResultChars?: number
  /** Default and maximum requested lines per call (default 200). */
  readonly detectiveCaptureMaxLines?: number
}

/** Validated schemas shared by Loader and direct apply callers. */
export const detectiveCaptureConfigFields = {
  detectiveCaptureMaxResultChars: z.number().step(1).min(512).max(Number.MAX_SAFE_INTEGER).default(4_000),
  detectiveCaptureMaxLines: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(200),
}

const settingsConfig = z.object(detectiveCaptureConfigFields)

/** Validated complete-result and line limits. */
export interface DetectiveCapturePolicy {
  readonly maxChars: number
  readonly maxLines: number
}

/**
 * Validate the saved-source reader's deployment limits.
 * @param settings - Loader or direct apply configuration.
 * @returns explicit limits without accessing any files.
 */
export function resolveDetectiveCapturePolicy(settings: DetectiveCaptureSettings): DetectiveCapturePolicy {
  const parsed = new settingsConfig(settings) as Required<DetectiveCaptureSettings>
  return { maxChars: parsed.detectiveCaptureMaxResultChars, maxLines: parsed.detectiveCaptureMaxLines }
}

interface CapturedFileIndex extends Omit<IntakeMaterial, 'content'> {
  byte_length: number
  line_count: number
}

/** Prompt-only admission projection; the durable admission retains every file's complete content. */
export type DetectiveIndexedAdmission = Omit<ConductorAdmission, 'materials'> & {
  materials: Array<IntakeMaterial | CapturedFileIndex>
}

function materialLines(content: string): string[] {
  const lines = content.split(/\r\n|\n|\r/)
  if (lines.at(-1) === '') lines.pop()
  return lines
}

interface CaptureArgs {
  material_id: string
  sha256: string
  selector: string
  start_line?: number
  line_count?: number
}

function readPage(materials: readonly IntakeMaterial[], args: CaptureArgs, policy: DetectiveCapturePolicy): string {
  const source = materials.find(material => material.kind === 'file' && material.id === args.material_id)
  if (source === undefined) throw new Error('Unknown captured file; use a file identity from the dispatch index.')
  const verified = captureIntakeMaterial(source.selector, source.content, source.sourceMessage)
  if (source.id !== verified.id || source.sha256 !== verified.sha256 || source.kind !== verified.kind
    || args.sha256 !== source.sha256 || args.selector !== source.selector) {
    throw new Error('Captured file identity or hash mismatch; no workspace fallback is permitted.')
  }
  const start = args.start_line ?? 1
  const limit = args.line_count ?? policy.maxLines
  if (!Number.isSafeInteger(start) || start < 1 || !Number.isSafeInteger(limit) || limit < 1 || limit > policy.maxLines) {
    throw new Error('Captured read requires positive integer start_line and line_count within the configured line limit.')
  }
  const lines = materialLines(source.content)
  if (start > lines.length) throw new Error('Captured read starts outside the saved file.')
  const page: string[] = []
  const render = () => JSON.stringify({
    material_id: source.id, selector: source.selector, sha256: source.sha256,
    total_lines: lines.length, start_line: start, end_line: start + page.length - 1, lines: page,
    truncated: start + page.length <= lines.length,
    next_start_line: start + page.length <= lines.length ? start + page.length : null,
  })
  for (const line of lines.slice(start - 1, start - 1 + Math.min(limit, lines.length - start + 1))) {
    page.push(line)
    if (Array.from(render()).length > policy.maxChars) {
      page.pop()
      break
    }
  }
  if (page.length === 0) throw new Error('A complete captured line and its metadata exceed the result limit; increase detectiveCaptureMaxResultChars. No source text was returned.')
  return render()
}

/**
 * Prepare a file index and a child-scoped reader over the same immutable capture.
 * @param admission - complete, durable v5 admission; never modified.
 * @param policy - validated result and line limits.
 * @param search - trusted Detective search installer to retain alongside the reader.
 * @returns prompt admission and one transactional child installer.
 */
export function prepareDetectiveCapture(
  admission: ConductorAdmission, policy: DetectiveCapturePolicy, search: SubagentChildToolContribution,
): { admission: DetectiveIndexedAdmission; childToolContribution: SubagentChildToolContribution } {
  const captured = admission.materials.map(material => ({ ...material }))
  const indexed: DetectiveIndexedAdmission = { ...admission, materials: captured.map((material) => {
    if (material.kind === 'current-request') return material
    const { content, ...identity } = material
    return { ...identity, byte_length: Buffer.byteLength(content), line_count: materialLines(content).length }
  }) }
  return { admission: indexed, childToolContribution: (childCtx) => {
    const stops: Array<() => void> = []
    const dispose = () => { for (const stop of stops.toReversed()) stop() }
    try {
      stops.push(search(childCtx))
      stops.push(childCtx.tools.register(defineTool({
        name: DETECTIVE_CAPTURE_READ_TOOL,
        description: 'Read complete lines from an indexed, hash-verified captured file, never the current workspace.',
        parameters: {
          material_id: { type: 'string', required: true, description: 'Exact file material id from the dispatch index.' },
          sha256: { type: 'string', required: true, description: 'Exact captured SHA-256 from the index.' },
          selector: { type: 'string', required: true, description: 'Exact file selector from the index.' },
          start_line: { type: 'number', description: 'Inclusive one-based first line; defaults to 1.' },
          line_count: { type: 'number', description: `Requested complete lines, default and maximum ${policy.maxLines}.` },
        },
        output: { schema: { type: 'string' }, render: (_args, value) => {
          if (Array.from(value).length > policy.maxChars) throw new Error('Captured read canonical output exceeds its result limit.')
          return [{ type: 'text', text: value }]
        } },
        execute: args => Promise.resolve(readPage(captured, args, policy)),
        isConcurrencySafe: () => true,
        finalizeContent: (_exec, result) => result.content.reduce((sum, block) => sum
          + Array.from(block.type === 'text' ? block.text : JSON.stringify(block)).length, 0) <= policy.maxChars
          ? undefined : [{ type: 'text', text: 'Captured read output exceeded its result limit and was omitted. Do not treat omitted source as inspected.' }],
        presentCall: args => ({ card: 'generic', kind: 'read', title: `Read captured ${args.selector}`,
          locations: [{ path: args.selector, line: args.start_line ?? 1 }] }),
      })))
      stops.push(childCtx.systemPrompt.section({ name: `tool:${DETECTIVE_CAPTURE_READ_TOOL}`, order: 105,
        text: `Captured files are indexed without their bodies. Use ${DETECTIVE_CAPTURE_READ_TOOL} with the exact material_id, sha256 and selector to inspect saved source. `
          + 'Results identify inclusive line ranges, truncation and next_start_line. Continue from next_start_line to inspect later lines. '
          + 'Cite only inspected lines in material_spans. Workspace read/search results are not substitutes for captured evidence. '
          + 'The current-request is already inline: cite it only for task scope, not corroboration of file facts, and do not pass its id to this file reader. '
          + 'For every id in candidate.material_ids, include candidate.material_spans entries with material_id, start_line and end_line; ranges within one material must not overlap or repeat. '
          + 'Sampled pages or workspace-only checks cannot establish completeness of uninspected captured ranges. Inspect the required saved ranges or disclose the limitation without claiming complete coverage. '
          + 'Keep all required findings, adverse evidence and uncertainty, and focus the report on the unchanged acceptance criteria.' }))
      return dispose
    } catch (error) {
      dispose()
      throw error
    }
  } }
}
