import { chmod, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

function layoutConflict(path: string): Error {
  return new Error(`Conductor resource layout conflict at ${path}; use a fresh installation directory for file/directory changes`)
}

async function readOptional(file: string): Promise<Buffer | undefined> {
  try {
    return await readFile(file)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EISDIR' || code === 'ENOTDIR') throw layoutConflict(file)
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

async function canonicalFiles(source: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>()
  const directories = [
    ['conductor/roles', 'roles'],
    ['conductor/templates', 'templates'],
    ...(await readdir(join(source, 'skills')))
      .filter(name => name.startsWith('conductor-'))
      .map(name => [`skills/${name}`, `protocols/${name}`]),
  ]
  files.set('README.md', await readFile(join(source, 'conductor/README.md')))
  for (const [from, to] of directories) {
    const directory = join(source, from!)
    // Unlike an absent output tree, a missing canonical directory is an error.
    await readdir(directory)
    for (const path of await filesIn(directory)) files.set(join(to!, path), await readFile(join(directory, path)))
  }
  return files
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
  const files = await canonicalFiles(source)
  const existing = await filesIn(destination)
  for (const path of files.keys()) {
    if (existing.some(old => path.startsWith(old + sep) || old.startsWith(path + sep))) {
      throw layoutConflict(join(destination, path))
    }
  }
  const changed: Array<[string, Buffer]> = []
  for (const [path, bytes] of files) {
    const previous = await readOptional(join(destination, path))
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
        const previous = await readOptional(target)
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
            const winner = await readOptional(target)
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
 * Prepare the CLI preset from the repository's sole authored Conductor sources.
 * @returns after installation resources match the canonical files.
 */
export async function generateConductorSkills(): Promise<void> {
  await syncConductorSkills(
    fileURLToPath(new URL('../../../.agents/', import.meta.url)),
    fileURLToPath(new URL('../config/agent-presets/conductor/skills/', import.meta.url)),
  )
}
