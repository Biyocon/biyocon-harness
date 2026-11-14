/** Public saved-source fixture and model substitute decisions for installed Conductor. */
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { IntakeMaterial } from '@deepseek-ai/dsh-conductor'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

/** Public synthetic evidence with a finding on its final cited line. */
export const CAPTURED_PLAN = '# Captured plan\n\nReview the release procedure.\nLATE_ADVERSE_FINDING: rollback is missing.\n'

/** Prompt-only file metadata, distinct from the complete durable capture. */
export type IndexedFixtureMaterial = Omit<IntakeMaterial, 'content'> & { line_count: number }

/**
 * Choose the next saved-source read using only the actual model-visible index and results.
 * @param options - current model history.
 * @param materials - dispatched request plus indexed captured files.
 * @returns next exact reader arguments, or undefined once all indexed lines were returned.
 */
export function nextDetectiveCaptureRead(
  options: GenerateOptions, materials: readonly (IntakeMaterial | IndexedFixtureMaterial)[],
): { material_id: string; sha256: string; selector: string; start_line: number } | undefined {
  const pages = options.messages.flatMap(message => message.content).flatMap((block) => {
    if (block.type !== 'tool-result' || block.toolCallId !== 'installed-conductor_read_capture') return []
    if (block.isError) throw new Error('Saved-source fixture read failed')
    return block.content.flatMap(item => item.type === 'text'
      ? [JSON.parse(item.text) as { material_id: string; next_start_line: number | null }] : [])
  })
  for (const material of materials) {
    if (material.kind !== 'file' || 'content' in material) continue
    const last = pages.findLast(page => page.material_id === material.id)
    if (last?.next_start_line === null) continue
    return { material_id: material.id, sha256: material.sha256, selector: material.selector, start_line: last?.next_start_line ?? 1 }
  }
  return undefined
}

/**
 * Replace only the synthetic file after its first captured page has been returned.
 * @param ctx - Loader context running the public model substitute.
 */
export function installDetectiveCaptureWorldChanges(ctx: Context): void {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (exec.name === 'conductor_read_capture' && !result.isError) {
      await writeFile(join(process.cwd(), 'plan.md'), 'EXTERNAL_REPLACEMENT_AFTER_CAPTURE\n')
    }
    return decision
  })
}
