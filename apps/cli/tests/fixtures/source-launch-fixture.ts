import { cp, mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { CONDUCTOR_ASSETS } from '../../../../packages/conductor/conductor-presets/scripts/prepare-assets.ts'

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
  for (const [path] of CONDUCTOR_ASSETS) {
    await cp(join(root, '.agents', path), join(checkout, '.agents', path), { recursive: true })
  }
  await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'junction')
  for (const path of ['scripts', 'presets', 'package.json']) {
    await cp(join(root, 'packages/conductor/conductor-presets', path), join(checkout, 'packages/conductor/conductor-presets', path), { recursive: true })
  }
  await symlink(join(root, 'apps/cli/node_modules'), join(cli, 'node_modules'), 'junction')
  await mkdir(join(checkout, 'packages/conductor/conductor-presets/node_modules/@deepseek-ai'), { recursive: true })
  await symlink(join(root, 'packages/fs/fs-local'), join(checkout, 'packages/conductor/conductor-presets/node_modules/@deepseek-ai/dsh-fs-local'), 'junction')
  let launches = 0
  return {
    directory, checkout, cli, workspace,
    async seedLegacy() {
      const legacy = join(cli, 'config/agent-presets/conductor')
      for (const [source, target] of CONDUCTOR_ASSETS) {
        await cp(join(checkout, '.agents', source), join(legacy, 'skills', target), { recursive: true })
      }
      return legacy
    },
    async dispose() {
      for (const path of [join(cli, 'node_modules'), join(checkout, 'node_modules'), join(checkout, 'packages/conductor/conductor-presets/node_modules/@deepseek-ai/dsh-fs-local')]) await unlink(path)
      await rm(directory, { recursive: true, force: true })
    },
    async launch(args = ['--profile', 'probe'], roster?: 'combined' | 'collision' | 'patch-collision') {
      const home = join(directory, `home-${++launches}`)
      const profile = join(home, 'profiles/probe')
      const bundle = join(profile, 'node_modules/dsh-source-probe')
      await mkdir(bundle, { recursive: true })
      await writeFile(join(profile, 'package.json'), JSON.stringify({
        name: 'dsh-source-probe-profile', private: true, dependencies: {}, dsh: { profile: { bundles: ['dsh-source-probe'] } },
      }))
      await writeFile(join(profile, 'cordis.patch.yml'), '[]\n')
      await writeFile(join(bundle, 'package.json'), JSON.stringify({
        name: 'dsh-source-probe', version: '0.0.0', type: 'module', dsh: { bundle: { patch: './cordis.patch.yml', ...(roster === undefined ? {} : { presetRoot: './presets' }) } },
      }))
      const configuredRoot = join(directory, 'configured-presets')
      if (roster !== undefined) {
        for (const [parent, id] of [
          [join(cli, 'config/agent-presets'), roster === 'collision' ? 'bundle' : 'cli'],
          [join(bundle, 'presets'), 'bundle'], [configuredRoot, roster === 'patch-collision' ? 'bundle' : 'configured'],
        ]) {
          await mkdir(join(parent!, id!), { recursive: true })
          await writeFile(join(parent!, id!, 'agent.cordis.yml'), '[]\n')
        }
      }
      const moduleUrl = (path: string) => pathToFileURL(join(root, path)).href
      await writeFile(join(bundle, 'probe.mjs'), `
import SkillRegistry from ${JSON.stringify(moduleUrl('packages/skill/skill/src/index.ts'))}
import * as presets from ${JSON.stringify(moduleUrl('packages/conductor/conductor-presets/src/index.ts'))}
import { join } from 'node:path'
export const name = 'source-conductor-probe'
export async function apply(ctx) {
  await ctx.plugin(SkillRegistry)
  const assets = ${JSON.stringify(join(checkout, 'packages/conductor/conductor-host-rc7/presets/conductor/skills'))}
  await ctx.plugin(presets, {
    rolesDirectory: join(assets, 'roles'),
    protocolDirectory: join(assets, 'protocols'),
    sharedProtocolFile: join(assets, 'README.md'),
  })
  await ctx.plugin({
    name: 'source-conductor-reader', inject: ['skills', 'cmdlineArgs', ...${JSON.stringify(roster === undefined ? [] : ['agentPresets'])}],
    async apply(ctx) {
      const role = await ctx.skills.get('conductor-detective', { cwd: process.cwd() })
      const protocol = await ctx.skills.get('conductor-specialist', { cwd: process.cwd() })
      console.log(JSON.stringify({
        ...${roster === undefined ? '{}' : '{ roster: (await ctx.agentPresets.list()).map(row => [row.id, row.trust]) }'},
        launchArgs: ctx.cmdlineArgs.get(), mounted: true, roleFresh: role.content.includes('SOURCE_ROLE_NEW'),
        sharedFresh: role.content.includes('SOURCE_SHARED_NEW'),
        protocolFresh: protocol.content.includes('SOURCE_PROTOCOL_NEW'),
      }))
      ctx.get('appExit')(0)
    },
  })
}
`)
      await writeFile(join(bundle, 'cordis.patch.yml'), `- insert:\n    - id: source-probe\n      name: ${pathToFileURL(join(bundle, 'probe.mjs')).href}\n${roster === undefined ? '' : `    - id: agent-presets\n      name: '@deepseek-ai/dsh-agent-presets'\n      config:\n        default: bundle\n        includeUserRoot: false\n        roots:\n          - path: ${JSON.stringify(configuredRoot)}\n            trust: system\n`}`)
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)))
      return execa(process.execPath, [
        '--import', pathToFileURL(join(root, 'node_modules/tsx/dist/esm/index.mjs')).href,
        '--import', pathToFileURL(join(checkout, 'packages/conductor/conductor-presets/scripts/prepare-source.ts')).href,
        join(checkout, 'apps/cli/scripts/source-launch.ts'), ...args,
      ], {
        cwd: workspace, input: '', reject: false, timeout: 25_000, killSignal: 'SIGKILL', extendEnv: false,
        env: { ...env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', TSX_TSCONFIG_PATH: join(root, 'tsconfig.json') },
      })
    },
  }
}
