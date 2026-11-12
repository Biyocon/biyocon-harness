import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { CONDUCTOR_ASSETS, syncConductorSkills } from '../scripts/prepare-assets.ts'
import { verifyConductorResources } from '../scripts/verify-pack.ts'

it('reads only 27 literal sources, excluding synthetic private data and unlisted roles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conductor-allowlist-'))
  try {
    const source = join(directory, 'source')
    for (const [path] of CONDUCTOR_ASSETS) {
      await mkdir(join(source, path, '..'), { recursive: true })
      await writeFile(join(source, path), path)
    }
    await mkdir(join(source, 'conductor/runs'), { recursive: true })
    await writeFile(join(source, 'conductor/runs/private.json'), 'SYNTHETIC_PRIVATE_MUST_NOT_SHIP')
    await writeFile(join(source, 'conductor/roles/00-conductor.md'), 'unlisted')
    const destination = join(directory, 'skills')
    await syncConductorSkills(source, destination)
    expect(CONDUCTOR_ASSETS).toHaveLength(27)
    expect(await readFile(join(destination, 'roles/00-conductor.webp'), 'utf8')).toBe('conductor/roles/00-conductor.webp')
    await expect(readFile(join(destination, 'roles/00-conductor.md'))).rejects.toThrow()
    await expect(readFile(join(destination, 'runs/private.json'))).rejects.toThrow()
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

it('rejects extra files, tampered bytes and a tampered manifest', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conductor-pack-invalid-'))
  try {
    const target = join(directory, 'presets')
    await cp(fileURLToPath(new URL('../../conductor-host-rc7/presets/', import.meta.url)), target, { recursive: true })
    await verifyConductorResources(target)
    const extra = join(target, 'conductor/skills/private.json')
    await writeFile(extra, 'synthetic private')
    await expect(verifyConductorResources(target)).rejects.toThrow('allowlist mismatch')
    await rm(extra)
    await writeFile(join(target, 'assets.manifest.json'), '[]')
    await expect(verifyConductorResources(target)).rejects.toThrow('manifest hash mismatch')
    await writeFile(join(target, 'conductor/skills/README.md'), 'tampered')
    await expect(verifyConductorResources(target)).rejects.toThrow('source hash mismatch')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
