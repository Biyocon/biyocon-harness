/** Keyless source CLI transcript for the rc.7 generated-directory upgrade guard. */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sourceLaunchFixture } from './fixtures/source-launch-fixture.ts'

it('refuses the exact legacy tree before boot and leaves its bytes available for backup', async () => {
  const fixture = await sourceLaunchFixture()
  try {
    const legacy = await fixture.seedLegacy()
    const marker = join(legacy, 'skills/README.md')
    const before = await readFile(marker)
    const result = await fixture.launch()
    expect(await readFile(marker)).toEqual(before)
    expect(existsSync(join(fixture.checkout, 'packages/conductor/conductor-host-rc7/presets'))).toBe(false)
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    const stderr = result.stderr.replaceAll('\\', '/').replaceAll(fixture.checkout.replaceAll('\\', '/'), '{{checkout}}')
    expect({ exitCode: result.exitCode, stdout: result.stdout, stderr }).toMatchInlineSnapshot(`
      {
        "exitCode": 1,
        "stderr": "dsh: could not prepare Conductor skills: Legacy generated Conductor preset directory blocks source startup: {{checkout}}/apps/cli/config/agent-presets/conductor
      Nothing was moved or deleted. Move this directory outside the preset roots, then retry:
      Move-Item -LiteralPath '{{checkout}}/apps/cli/config/agent-presets/conductor' -Destination ('{{checkout}}-conductor-cli-backup-' + [guid]::NewGuid().ToString('N')) -ErrorAction Stop",
        "stdout": "",
      }
    `)
  } finally {
    await fixture.dispose()
  }
})

it('boots a fresh source checkout and forwards the port arguments to the application', async () => {
  const fixture = await sourceLaunchFixture()
  try {
    const result = await fixture.launch(['--profile', 'probe', '--port', '3090'])
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stderr).toBe('')
    const output = JSON.parse(result.stdout) as { launchArgs: string[] }
    expect(output.launchArgs).toEqual(['--port', '3090'])
    expect(output).toMatchInlineSnapshot(`
      {
        "launchArgs": [
          "--port",
          "3090",
        ],
        "mounted": true,
        "protocolFresh": false,
        "roleFresh": false,
        "sharedFresh": false,
      }
    `)
  } finally {
    await fixture.dispose()
  }
})
