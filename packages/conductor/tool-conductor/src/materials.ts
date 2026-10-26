/** Capture only the current user message and its explicitly cited workspace files. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { captureIntakeMaterial } from '@deepseek-ai/dsh-conductor'
import type { IntakeMaterial } from '@deepseek-ai/dsh-conductor'
import type {} from '@deepseek-ai/dsh-fs'

/** Validated deployment limits for complete captured material. */
export interface MaterialLimits {
  maxMaterialFiles: number
  maxMaterialBytes: number
  maxMaterialTotalBytes: number
}

function cited(text: string, path: string): boolean {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|[\\s\x60'"(])${escaped}(?=$|[\\s\x60'"),.;:!?])`).test(text.replaceAll('\\', '/'))
}

/**
 * Capture bounded files through the existing filesystem service, never a recursive scan.
 * @param ctx - tool context; filesystem is required only when files are cited.
 * @param parent - authoritative session containing the actual user message.
 * @param files - explicit workspace-relative selectors from tool JSON.
 * @param limits - complete-input byte/count limits.
 * @param signal - operation cancellation.
 * @returns captured inputs with content hashes and host-minted ids.
 */
export async function captureMaterials(
  ctx: Context, parent: Agent, files: readonly string[], limits: MaterialLimits, signal: AbortSignal,
): Promise<IntakeMaterial[]> {
  const eventIndex = parent.session.events.findLastIndex(event => event.type === 'user/message' && event.data.source.kind === 'user')
  const event = parent.session.events[eventIndex]
  if (event?.type !== 'user/message') throw new Error('Conductor intake requires the actual current user message')
  if (event.data.content.some(block => block.type !== 'text')) throw new Error('Conductor phase 1 accepts text material; attachment admission is not supported')
  const text = event.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  const materials = [captureIntakeMaterial('current-request', text, { sessionId: parent.session.id, eventIndex })]
  if (files.length > limits.maxMaterialFiles || new Set(files).size !== files.length) throw new Error('Conductor material file count exceeds its configured limit or contains duplicates')
  const checkTotal = (): void => {
    if (Buffer.byteLength(JSON.stringify(materials)) > limits.maxMaterialTotalBytes) throw new Error('Conductor captured material exceeds maxMaterialTotalBytes')
  }
  if (Buffer.byteLength(text) > limits.maxMaterialBytes) throw new Error('Conductor user message exceeds maxMaterialBytes')
  checkTotal()
  if (!files.length) return materials
  const fs = ctx.get('fs')
  const cwd = parent.session.header.cwd
  if (fs === undefined || cwd === undefined) throw new Error('Conductor file material requires a filesystem and workspace')
  const root = await fs.resolve('.', { cwd, signal })
  for (const path of files) {
    if (!path || path.includes('\\') || path.startsWith('/') || path.includes(':')
      || path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Conductor material paths must be normalized workspace-relative file paths')
    if (!cited(text, path) && !cited(text, `${cwd.replaceAll('\\', '/').replace(/\/$/, '')}/${path}`)) {
      throw new Error(`Conductor material ${path} is not explicitly cited in the current user message`)
    }
    const target = await fs.resolve(path, { cwd, signal })
    if (!fs.contains(root, target)) throw new Error('Conductor material path escapes the workspace')
    const before = await fs.stat(target, signal)
    if (before?.type !== 'file') throw new Error('Conductor material must be an accessible regular file')
    const bytes = await fs.readBytes(target, signal, limits.maxMaterialBytes)
    const afterTarget = await fs.resolve(path, { cwd, signal })
    const after = await fs.stat(afterTarget, signal)
    if (afterTarget.targetKey !== target.targetKey || !fs.contains(root, afterTarget) || before.version !== after?.version) {
      throw new Error('Conductor material changed while being captured')
    }
    const content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
    if (content.includes('\0')) throw new Error('Conductor material must be UTF-8 text')
    materials.push(captureIntakeMaterial(path, content))
    checkTotal()
  }
  return materials
}
