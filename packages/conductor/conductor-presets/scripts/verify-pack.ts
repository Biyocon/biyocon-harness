/** Verify the real rc.7 tarball against the literal canonical resource allowlist. */
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { CONDUCTOR_ASSETS } from './prepare-assets.ts'

const repository = fileURLToPath(new URL('../../../../', import.meta.url))

/** Validate exact packed files and hashes, including the generated manifest. */
export async function verifyConductorResources(directory: string, sourceRoot = repository): Promise<void> {
  const expected = new Map<string, Buffer>()
  const sources = new Map<string, string>()
  for (const [source, target] of CONDUCTOR_ASSETS) {
    expected.set(`conductor/skills/${target}`, await readFile(join(sourceRoot, '.agents', source)))
    sources.set(`conductor/skills/${target}`, `.agents/${source}`)
  }
  for (const name of ['preset.yml', 'agent.cordis.yml']) {
    expected.set(`conductor/${name}`, await readFile(join(sourceRoot, 'packages/conductor/conductor-presets/presets/conductor', name)))
    sources.set(`conductor/${name}`, `packages/conductor/conductor-presets/presets/conductor/${name}`)
  }
  const files = await readdir(directory, { recursive: true, withFileTypes: true })
  if (files.some(file => file.isSymbolicLink())) throw new Error('Conductor resources must not contain symlinks')
  const found = files.filter(file => file.isFile()).map(file =>
    join(file.parentPath, file.name).slice(directory.length + 1).replaceAll('\\', '/')).sort()
  const names = [...expected.keys(), 'assets.manifest.json'].sort()
  if (JSON.stringify(found) !== JSON.stringify(names)) throw new Error('Conductor packed resource allowlist mismatch')
  const hashes = []
  for (const [path, bytes] of expected) {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (createHash('sha256').update(await readFile(join(directory, path))).digest('hex') !== sha256) {
      throw new Error(`Conductor packed source hash mismatch: ${path}`)
    }
    hashes.push({ source: sources.get(path), path, sha256 })
  }
  const manifest = JSON.parse(await readFile(join(directory, 'assets.manifest.json'), 'utf8')) as unknown
  if (JSON.stringify(manifest) !== JSON.stringify(hashes)) throw new Error('Conductor resource manifest hash mismatch')
}

/** Pack and extract into a private temporary directory; never use a workspace link as evidence. */
export async function verifyConductorPack(): Promise<void> {
  const temporary = await mkdtemp(join(tmpdir(), 'dsh-conductor-pack-'))
  try {
    const result = await execa('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
      cwd: join(repository, 'packages/conductor/conductor-host-rc7'), shell: process.platform === 'win32',
    })
    const [pack] = JSON.parse(result.stdout) as Array<{ filename: string }>
    if (pack === undefined) throw new Error('npm pack produced no Conductor tarball')
    await execa('tar', ['-xzf', join(temporary, pack.filename), '-C', temporary])
    for (const path of ['lib/index.js', 'lib/invariant.js', 'cordis.patch.yml']) await readFile(join(temporary, 'package', path))
    await verifyConductorResources(join(temporary, 'package/presets'))
    console.log('verify-conductor-pack: 29 preset files and manifest match canonical SHA-256 hashes')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.includes('--resources')) {
    await verifyConductorResources(join(repository, 'packages/conductor/conductor-host-rc7/presets'))
    console.log('verify-conductor-resources: committed allowlist and canonical SHA-256 hashes match')
  } else {
    await verifyConductorPack()
  }
}
