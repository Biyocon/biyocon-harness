import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function layoutConflict(path: string, destination: string): Error {
  return new Error(`Conductor resource layout conflict at ${path}. The generated skills directory ${destination} is ignored by git and can be removed safely; it will be rebuilt on the next launch.`)
}

async function readOptional(file: string, destination: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EISDIR' || code === 'ENOTDIR') throw layoutConflict(file, destination)
    if (code !== 'ENOENT') throw error
    return undefined
  }
}

async function filesIn(directory: string): Promise<string[]> {
  try {
    return (await readdir(directory, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile())
      .map(entry => relative(directory, join(entry.parentPath, entry.name)))
      .sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return []
  }
}

/** The literal publication allowlist; no canonical directory is traversed. */
export const CONDUCTOR_ASSETS: ReadonlyArray<readonly [string, string]> = [
  ['conductor/README.md', 'README.md'],
  ['conductor/roles/profiles.yml', 'roles/profiles.yml'],
  ['conductor/roles/00-conductor.webp', 'roles/00-conductor.webp'],
  ['conductor/roles/01-detective.md', 'roles/01-detective.md'],
  ['conductor/roles/01-detective.webp', 'roles/01-detective.webp'],
  ['conductor/roles/02-strategist.md', 'roles/02-strategist.md'],
  ['conductor/roles/02-strategist.webp', 'roles/02-strategist.webp'],
  ['conductor/roles/03-devils-advocate.md', 'roles/03-devils-advocate.md'],
  ['conductor/roles/03-devils-advocate.webp', 'roles/03-devils-advocate.webp'],
  ['conductor/roles/04-headsman.md', 'roles/04-headsman.md'],
  ['conductor/roles/04-headsman.webp', 'roles/04-headsman.webp'],
  ['conductor/roles/05-auditor.md', 'roles/05-auditor.md'],
  ['conductor/roles/05-auditor.webp', 'roles/05-auditor.webp'],
  ['conductor/roles/06-integrator.md', 'roles/06-integrator.md'],
  ['conductor/roles/06-integrator.webp', 'roles/06-integrator.webp'],
  ['conductor/roles/07-the-arbiter.md', 'roles/07-the-arbiter.md'],
  ['conductor/roles/07-the-arbiter.webp', 'roles/07-the-arbiter.webp'],
  ['conductor/templates/baseline.md', 'templates/baseline.md'],
  ['conductor/templates/closeout.md', 'templates/closeout.md'],
  ['conductor/templates/dispatch.md', 'templates/dispatch.md'],
  ['conductor/templates/gate-decision.md', 'templates/gate-decision.md'],
  ['conductor/templates/run.md', 'templates/run.md'],
  ['conductor/templates/specialist-envelope.md', 'templates/specialist-envelope.md'],
  ['skills/conductor-closeout/SKILL.md', 'protocols/conductor-closeout/SKILL.md'],
  ['skills/conductor-orchestration/SKILL.md', 'protocols/conductor-orchestration/SKILL.md'],
  ['skills/conductor-ralph/SKILL.md', 'protocols/conductor-ralph/SKILL.md'],
  ['skills/conductor-specialist/SKILL.md', 'protocols/conductor-specialist/SKILL.md'],
]

async function canonicalFiles(source: string): Promise<Map<string, Buffer>> {
  return new Map(await Promise.all(CONDUCTOR_ASSETS.map(async ([from, to]) =>
    [to, await readFile(join(source, from))] as const)))
}

/**
 * Publish canonical Conductor files without truncating or removing the active tree.
 * Unchanged bytes cause no writes. Concurrent publishers of the same sources may
 * share a destination; each rename exposes a complete file, not a tree transaction.
 * Initial installation publishes the complete directory in one rename.
 * @param source - absolute canonical .agents directory.
 * @param destination - absolute generated skills directory owned by this generator.
 * @returns after changed files are published and obsolete files are removed.
 * @throws on source, staging, or publication failures; never retries a failed rename.
 */
export async function syncConductorSkills(source: string, destination: string): Promise<void> {
  await publishConductorFiles(await canonicalFiles(source), destination)
}

/** Publish complete package resources, preserving open readers and unchanged files. */
export async function publishConductorFiles(files: ReadonlyMap<string, Buffer>, destination: string): Promise<void> {
  const existing = await filesIn(destination)
  for (const path of files.keys()) {
    if (existing.some(old => path.startsWith(old + sep) || old.startsWith(path + sep))) {
      throw layoutConflict(join(destination, path), destination)
    }
  }
  const changed: Array<[string, Buffer]> = []
  for (const [path, bytes] of files) {
    const previous = await readOptional(join(destination, path), destination)
    if (previous === undefined || !bytes.equals(previous)) changed.push([path, bytes])
  }
  const obsolete = existing.filter(path => !files.has(path))
  if (changed.length === 0 && obsolete.length === 0) return

  if (changed.length > 0) {
    const parent = dirname(destination)
    await mkdir(parent, { recursive: true })
    const staging = await mkdtemp(join(parent, '.conductor-skills-'))
    try {
      for (const [path, bytes] of changed) {
        await mkdir(dirname(join(staging, path)), { recursive: true })
        await writeFile(join(staging, path), bytes, { flag: 'wx' })
      }
      if (process.platform !== 'win32') await chmod(staging, (await stat(parent)).mode & 0o777)
      if (changed.length === files.size) {
        try {
          await rename(staging, destination)
          return
        } catch (error) {
          // Another publisher or a prior installation owns a nonempty destination.
          // Only directory-replacement conflicts permit per-file publication.
          if (!['EEXIST', 'ENOTEMPTY', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
          await readdir(destination)
        }
      }
      for (const [path, bytes] of changed) {
        const target = join(destination, path)
        const previous = await readOptional(target, destination)
        if (previous !== undefined && bytes.equals(previous)) continue
        await mkdir(dirname(target), { recursive: true })
        if (process.platform === 'win32' && previous !== undefined) {
          const { replaceFileWin32 } = await import('@deepseek-ai/dsh-fs-local/src/win32.ts')
          await replaceFileWin32(target, join(staging, path))
        } else {
          try {
            await rename(join(staging, path), target)
          } catch (error) {
            // A concurrent creator can win after the absent-target read. Accept
            // only its complete identical bytes, never retry or remove its file.
            if (previous !== undefined || !['EEXIST', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
            const winner = await readOptional(target, destination)
            if (winner === undefined || !bytes.equals(winner)) throw error
          }
        }
      }
    } finally {
      // This invocation owns only its unique sibling staging directory.
      await rm(staging, { recursive: true, force: true })
    }
  }
  // Resolve actual stored spellings before cleanup: a case-only source rename
  // can still address an installed file through both spellings on Windows/macOS.
  const retained = obsolete.length === 0 ? new Set<string>()
    : new Set(await Promise.all([...files.keys()].map(path => realpath(join(destination, path)))))
  for (const path of obsolete) {
    try {
      if (retained.has(await realpath(join(destination, path)))) continue
      await unlink(join(destination, path))
    } catch (error) {
      // Concurrent publishers of these same sources may already have removed it.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
}

/**
 * Prepare the packaged preset from the repository's sole authored Conductor sources.
 * @returns after installation resources match the canonical files.
 */
export async function generateConductorSkills(): Promise<void> {
  const assets = await canonicalFiles(fileURLToPath(new URL('../../../../.agents/', import.meta.url)))
  const files = new Map([...assets].map(([path, bytes]) => [join('conductor/skills', path), bytes]))
  const sources = new Map(CONDUCTOR_ASSETS.map(([source, target]) => [join('conductor/skills', target), `.agents/${source}`]))
  for (const file of ['preset.yml', 'agent.cordis.yml']) {
    files.set(join('conductor', file), await readFile(new URL(`../presets/conductor/${file}`, import.meta.url)))
    sources.set(join('conductor', file), `packages/conductor/conductor-presets/presets/conductor/${file}`)
  }
  const manifest = [...files].map(([path, bytes]) => ({
    source: sources.get(path), path: path.replaceAll('\\', '/'), sha256: createHash('sha256').update(bytes).digest('hex'),
  }))
  files.set('assets.manifest.json', Buffer.from(JSON.stringify(manifest, undefined, 2) + '\n'))
  await publishConductorFiles(files, fileURLToPath(new URL('../../conductor-host-rc7/presets/', import.meta.url)))
}
