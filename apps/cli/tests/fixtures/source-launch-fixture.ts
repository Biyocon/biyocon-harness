import { cp, mkdir, mkdtemp, readdir, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'

const root = fileURLToPath(new URL('../../../../', import.meta.url))

/**
 * Copy only the source launcher and canonical instructions; dependencies stay read-only.
 * @returns an isolated checkout with a separate home for each short-lived probe.
 */
export async function sourceLaunchFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-source-conductor-'))
  const checkout = join(directory, 'checkout')
  const cli = join(checkout, 'apps/cli')
  const workspace = join(directory, 'external-workspace')
  await mkdir(cli, { recursive: true })
  await mkdir(workspace)
  for (const path of ['src', 'scripts', 'package.json']) {
    await cp(join(root, 'apps/cli', path), join(cli, path), { recursive: true })
  }
  await cp(join(root, '.agents/conductor'), join(checkout, '.agents/conductor'), { recursive: true })
  for (const name of (await readdir(join(root, '.agents/skills'))).filter(name => name.startsWith('conductor-'))) {
    await cp(join(root, '.agents/skills', name), join(checkout, '.agents/skills', name), { recursive: true })
  }
  await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'junction')
  await symlink(join(root, 'packages'), join(checkout, 'packages'), 'junction')
  await symlink(join(root, 'apps/cli/node_modules'), join(cli, 'node_modules'), 'junction')
  let launches = 0
  return {
    directory, checkout, cli, workspace,
    async dispose() {
      for (const path of [join(cli, 'node_modules'), join(checkout, 'node_modules'), join(checkout, 'packages')]) await unlink(path)
      await rm(directory, { recursive: true, force: true })
    },
    async launch(args = ['--profile', 'probe']) {
      const home = join(directory, `home-${++launches}`)
      const profile = join(home, 'profiles/probe')
      const bundle = join(profile, 'node_modules/dsh-source-probe')
      await mkdir(bundle, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        name: 'dsh-source-probe-profile', private: true, dependencies: {}, dsh: { profile: { bundles: ['dsh-source-probe'] } },
      }))
      await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
      await writeFile(join(bundle, 'package.json'), JSON.stringify({
        name: 'dsh-source-probe', version: '0.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml' } },
      }))
      const moduleUrl = (path: string) => pathToFileURL(join(root, path)).href
      await writeFile(join(bundle, 'probe.mjs'), `
import SkillRegistry from ${JSON.stringify(moduleUrl('packages/skill/skill/src/index.ts'))}
import * as presets from ${JSON.stringify(moduleUrl('packages/conductor/conductor-presets/src/index.ts'))}
import { join } from 'node:path'
export const name = 'source-conductor-probe'
export async function apply(ctx) {
  await ctx.plugin(SkillRegistry)
  const assets = ${JSON.stringify(join(cli, 'config/agent-presets/conductor/skills'))}
  await ctx.plugin(presets, {
    rolesDirectory: join(assets, 'roles'),
    protocolDirectory: join(assets, 'protocols'),
    sharedProtocolFile: join(assets, 'README.md'),
  })
  await ctx.plugin({
    name: 'source-conductor-reader', inject: ['skills'],
    async apply(ctx) {
      const role = await ctx.skills.get('conductor-detective', { cwd: process.cwd() })
      const protocol = await ctx.skills.get('conductor-specialist', { cwd: process.cwd() })
      console.log(JSON.stringify({
        mounted: true, roleFresh: role.content.includes('SOURCE_ROLE_NEW'),
        sharedFresh: role.content.includes('SOURCE_SHARED_NEW'),
        protocolFresh: protocol.content.includes('SOURCE_PROTOCOL_NEW'),
      }))
      ctx.get('appExit')(0)
    },
  })
}
`)
      await writeFile(join(bundle, 'cordis.patch.yml'), `- insert:\n    - id: source-probe\n      name: ${pathToFileURL(join(bundle, 'probe.mjs')).href}\n`)
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)))
      return execa(process.execPath, [
        '--import', pathToFileURL(join(root, 'node_modules/tsx/dist/esm/index.mjs')).href,
        join(cli, 'scripts/source-launch.ts'), ...args,
      ], {
        cwd: workspace, input: '', reject: false, timeout: 25_000, killSignal: 'SIGKILL', extendEnv: false,
        env: { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') },
      })
    },
  }
}
