/** Detect only the obsolete generated CLI asset tree; never move or remove it. */
import { readdir } from 'node:fs/promises'
import { basename, dirname, join, relative } from 'node:path'
import { CONDUCTOR_ASSETS } from './prepare-assets.ts'

const files = new Set<string>(CONDUCTOR_ASSETS.map(([, path]) => path))
const directories = new Set<string>([...files].flatMap((path) => {
  const parts = path.split('/')
  return parts.slice(1).map((_, index) => parts.slice(0, index + 1).join('/'))
}))

/**
 * Refuse the exact legacy CLI tree before preparation or profile migration.
 * @param checkout - absolute source checkout directory.
 * @returns when this known leftover is absent; other preset layouts keep ordinary validation.
 * @throws an actionable error naming the leftover and a non-destructive PowerShell backup command.
 */
export async function assertNoLegacyConductorRoot(checkout: string): Promise<void> {
  const root = join(checkout, 'apps/cli/config/agent-presets/conductor')
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (error) {
    // A fresh checkout has no legacy directory; all other I/O failures stop preflight.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
    throw error
  }
  if (entries.length !== 1 || entries[0]!.name !== 'skills' || !entries[0]!.isDirectory()) return
  const skills = join(root, 'skills')
  const tree = await readdir(skills, { recursive: true, withFileTypes: true })
  if (tree.length !== files.size + directories.size || !tree.every((entry) => {
    const path = relative(skills, join(entry.parentPath, entry.name)).replaceAll('\\', '/')
    return entry.isFile() ? files.has(path) : entry.isDirectory() && directories.has(path)
  })) return
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`
  const backup = join(dirname(checkout), `${basename(checkout)}-conductor-cli-backup-`)
  throw new Error([
    `Legacy generated Conductor preset directory blocks source startup: ${root}`,
    'Nothing was moved or deleted. Move this directory outside the preset roots, then retry:',
    `Move-Item -LiteralPath ${quote(root)} -Destination (${quote(backup)} + [guid]::NewGuid().ToString('N')) -ErrorAction Stop`,
  ].join('\n'))
}
