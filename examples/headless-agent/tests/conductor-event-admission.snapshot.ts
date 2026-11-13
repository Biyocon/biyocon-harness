import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'
import { runLoaderSmoke, resolveExampleLaunch, LOADER_SMOKE_TEST_TIMEOUT_MS } from '@deepseek-ai/dsh-loader-smoke'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const config = join(root, 'examples/headless-agent/conductor-event-admission.cordis.snapshot.yml')
const driver = join(root, 'examples/headless-agent/tests/fixtures/conductor-event-admission-driver.ts')

it.each([
  { kind: 'current', bundle: 'with-bundle' },
  { kind: 'current', bundle: 'without-bundle' },
  { kind: 'chat', bundle: 'without-bundle' },
  { kind: 'format4', bundle: 'with-bundle' },
  { kind: 'invalid', bundle: 'with-bundle' },
])('required-event admission: $kind $bundle, including a cold process restart', async ({ kind, bundle }) => {
  let restartedOutput = ''
  const result = await runLoaderSmoke({
    label: 'Conductor event admission', tempDirPrefix: 'conductor-admission-',
    binScript: driver, libBinScript: driver, configPath: config, binArgs: [config, kind, bundle, 'seed'],
    tsconfigPath: join(root, 'tsconfig.json'), env: { DSH_TELEMETRY_DISABLED: '1' },
    inspect: async (cwd) => {
      const launch = resolveExampleLaunch({ srcBin: driver, libBin: driver, configArgs: [config, kind, bundle, 'reopen'],
        tsconfigPath: join(root, 'tsconfig.json'), env: { DSH_HOME: join(cwd, '.dsh'), DSH_AGENTS_HOME: join(cwd, '.agents') },
      })
      const restarted = await execa(launch.command, launch.args, { cwd, env: launch.env, input: '', timeout: 30_000 })
      expect(restarted.stderr).toBe('')
      restartedOutput = restarted.stdout.trim()
    },
  })
  expect(result.stderr).toBe('')
  expect(result.stdout.trim()).toBe(restartedOutput)
  const expected = await readFile(join(root, `examples/headless-agent/tests/snapshots/conductor-event-admission/${kind}-${bundle}.expected.md`), 'utf8')
  expect(`${result.stdout.trim()}\nCold process restart: same result, no repeated work\n`).toBe(expected)
}, LOADER_SMOKE_TEST_TIMEOUT_MS)
