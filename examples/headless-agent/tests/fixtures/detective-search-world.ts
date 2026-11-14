/** Public search world and an external writer for installed Conductor pagination. */
import { mkdir, utimes, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolResultBlock } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-tools'

/**
 * Prepare deterministic paths and matching lines beyond one default page.
 * @param cwd - the isolated example workspace.
 */
export async function prepareDetectiveSearchWorld(cwd: string): Promise<void> {
  for (const [groupIndex, group] of ['alpha', 'beta', 'gamma'].entries()) {
    const dir = join(cwd, 'search-fixture', group)
    await mkdir(dir, { recursive: true })
    for (let i = 0; i < 16; i += 1) {
      const path = join(dir, `component-${String(i).padStart(2, '0')}-${'public'.repeat(10)}.ts`)
      await writeFile(path, `export const publicValue = ${i}\n`)
      const timestamp = new Date(Date.UTC(2020, 0, 1, 0, 0, groupIndex * 16 + i))
      await utimes(path, timestamp, timestamp)
    }
  }
  await writeFile(join(cwd, 'search-fixture', 'needle.txt'), Array.from({ length: 48 }, (_, i) =>
    `NEEDLE ${String(i + 1).padStart(2, '0')}: ${'public evidence '.repeat(8)}${i === 47 ? 'LATE_RELEVANT_FINDING' : ''}`).join('\n'))
}

/**
 * Change only the synthetic external workspace after each search's first page.
 * @param ctx - the Loader context running the public model substitute.
 */
export function installDetectiveSearchWorldChanges(ctx: Context): void {
  ctx.on('tools/post-execute', async (exec, result, next) => {
    const decision = await next()
    if (result.isError || !('pattern' in (exec.arguments as object))) return decision
    if (exec.name === 'glob') {
      await writeFile(join(process.cwd(), 'search-fixture', 'created-after-glob.ts'), 'EXTERNAL_NEW_PATH\n')
    } else if (exec.name === 'grep') {
      await writeFile(join(process.cwd(), 'search-fixture', 'needle.txt'), 'EXTERNAL_REPLACEMENT_WITHOUT_MATCHES\n')
    }
    return decision
  })
}

/**
 * Choose the next model call from the actual preceding page, including its random cursor.
 * @param result - the last tool result in the producing child's model history.
 * @returns the next discovery call, or undefined after both complete searches.
 */
export function nextDetectiveSearchPage(result: ToolResultBlock | undefined): {
  name: 'glob' | 'grep'
  args: Record<string, string>
} | undefined {
  if (result === undefined) return { name: 'glob', args: { pattern: 'search-fixture/**/*.ts' } }
  if (result.isError === true) throw new Error('Installed Detective search page failed')
  const text = result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
  const next = /^Next page: (glob|grep)\(([^\n]+)\)$/m.exec(text)
  if (next !== null) {
    const args = JSON.parse(next[2]!) as { cursor: string }
    return { name: next[1] as 'glob' | 'grep', args }
  }
  if (result.toolCallId === 'installed-glob') return { name: 'grep', args: { pattern: 'NEEDLE', path: 'search-fixture/needle.txt' } }
  return undefined
}
