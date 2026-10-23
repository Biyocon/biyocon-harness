import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleMode, runLoaderSmoke,
} from '@deepseek-ai/dsh-loader-smoke'

const binScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const configPath = fileURLToPath(new URL('../../../packages/bundle/web-app/cordis.patch.yml', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))

// The shipped profile resolves package exports under plain Node; this lane requires a build.
describe.skipIf(resolveExampleMode() !== 'lib')('web profile help assembled snapshot', () => {
  it('names Biyocon Harness through the shipped CLI and profile Loader', async () => {
    const result = await runLoaderSmoke({
      label: 'web profile help snapshot',
      tempDirPrefix: 'dsh-web-help-snapshot-',
      binScript,
      configPath,
      tsconfigPath,
      binArgs: ['--profile', 'web', '--help'],
      env: {
        DSH_TELEMETRY_DISABLED: '1',
        DEEPSEEK_API_KEY: undefined,
        DEEPSEEK_BASE_URL: undefined,
      },
    })
    expect(result.stdout).toContain('Serve the Biyocon Harness browser UI.')
    expect(result.stdout).not.toContain('DeepSeek Harness')
    expect(result.stderr).toBe('')
    expect(result).toMatchInlineSnapshot(`
      {
        "stderr": "",
        "stdout": "Usage: dsh --profile web [options]

      Serve the Biyocon Harness browser UI.

      Options:
        --host <host>                  bind host
        --port <port>                  listen port; pass 0 to let the OS pick a free
                                       one
        --trusted-host <authority...>  extra authority the /api browser-trust fence
                                       accepts (host or host:port; repeatable)
        -h, --help                     show this help

      Examples:
        dsh --profile web                          serve on the composed host and port
        dsh --profile web --port 8080              serve on another port

      ",
      }
    `)
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
