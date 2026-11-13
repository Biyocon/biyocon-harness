import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { verifyConductorPack } from '../../conductor-presets/scripts/verify-pack.ts'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const app = join(root, 'packages/conductor/conductor-host-rc7')

it('ships byte-identical canonical Conductor resources in the rc.7 host package', async () => {
  const sources = [
    { source: '.agents/conductor/roles', destination: 'roles' },
    { source: '.agents/conductor/templates', destination: 'templates' },
    ...(await readdir(join(root, '.agents/skills')))
      .filter(name => name.startsWith('conductor-'))
      .map(name => ({ source: `.agents/skills/${name}`, destination: `protocols/${name}` })),
  ]
  const pack = await execa('npm', ['pack', '--dry-run', '--json'], {
    cwd: app, shell: process.platform === 'win32', timeout: 30_000,
  })
  const [manifest] = JSON.parse(pack.stdout) as Array<{ files: Array<{ path: string }> }>
  const packed = new Set(manifest!.files.map(file => file.path))
  const shared = 'presets/conductor/skills/README.md'
  const expected: string[] = [shared]
  expect(packed.has(shared)).toBe(true)
  expect(await readFile(join(app, shared))).toEqual(await readFile(join(root, '.agents/conductor/README.md')))
  for (const { source, destination } of sources) {
    for (const file of await readdir(join(root, source), { recursive: true, withFileTypes: true })) {
      if (!file.isFile()) continue
      const path = relative(join(root, source), join(file.parentPath, file.name))
      const resource = `presets/conductor/skills/${destination}/${path.replaceAll('\\', '/')}`
      expected.push(resource)
      expect(packed.has(resource), resource).toBe(true)
      expect(await readFile(join(app, resource)), resource).toEqual(await readFile(join(root, source, path)))
    }
  }
  expect([...packed].filter(path => path.startsWith('presets/conductor/skills/')).sort())
    .toEqual(expected.sort())
}, 45_000)

it('verifies the actual tarball with canonical hashes', async () => {
  await verifyConductorPack()
}, 30_000)
