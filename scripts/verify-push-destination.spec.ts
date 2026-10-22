import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALLOWED_PUSH_REPOSITORY,
  normalizePushRepository,
  validatePushDestination,
} from '../.lefthook/pre-push/verify-push-destination.mjs'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const validator = fileURLToPath(new URL('../.lefthook/pre-push/verify-push-destination.mjs', import.meta.url))
const dispatcher = fileURLToPath(new URL('./run-lefthook.mjs', import.meta.url))
const lefthookPackage = fileURLToPath(import.meta.resolve('lefthook/package.json'))
const lefthookEntrypoint = join(dirname(lefthookPackage), 'bin/index.js')
const nativeLefthook = createRequire(lefthookPackage).resolve(
  `lefthook-${process.platform === 'win32' ? 'windows' : process.platform}-${process.arch}/bin/lefthook${process.platform === 'win32' ? '.exe' : ''}`,
)
const productionConfig = readFileSync(new URL('../lefthook.yml', import.meta.url), 'utf8')
const fork = 'https://github.com/Biyocon/deepseek-harness.git'
const upstream = 'https://github.com/deepseek-ai/deepseek-harness.git'
const transportKey = 'DSH_GIT_PRE_PUSH_ARGS'
const fixtures: string[] = []

interface HookFixture {
  root: string
  marker: string
  sentinel: string
  env: NodeJS.ProcessEnv
  head: string
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) removeFixtureSafely(fixture)
})

function command(fixture: Pick<HookFixture, 'root' | 'env'>, executable: string, args: string[], input = '') {
  const result = spawnSync(executable, args, {
    cwd: fixture.root,
    encoding: 'utf8',
    env: fixture.env,
    input,
  })
  if (result.error !== undefined) throw result.error
  return result
}

function checked(fixture: Pick<HookFixture, 'root' | 'env'>, executable: string, args: string[]) {
  const result = command(fixture, executable, args)
  if (result.status !== 0) throw new Error(result.stdout + result.stderr)
  return result.stdout.trim()
}

function hookConfig() {
  if (!productionConfig.includes('run: pnpm run typecheck')) throw new Error('missing production typecheck job')
  return productionConfig.replace('run: pnpm run typecheck', 'run: node .lefthook/pre-push/typecheck-marker.mjs')
}

function createHookFixture(options: { oldConfig?: boolean } = {}): HookFixture {
  const container = mkdtempSync(join(tmpdir(), 'dsh-push-guard-'))
  fixtures.push(container)
  const root = join(container, 'repository with spaces')
  const scripts = join(root, '.lefthook/pre-push')
  const marker = join(root, 'typecheck-ran')
  const sentinel = join(root, 'unexpected-command')
  mkdirSync(scripts, { recursive: true })
  mkdirSync(join(root, 'scripts'))
  mkdirSync(join(root, 'node_modules'))
  symlinkSync(dirname(lefthookPackage), join(root, 'node_modules/lefthook'), process.platform === 'win32' ? 'junction' : 'dir')
  copyFileSync(validator, join(scripts, 'verify-push-destination.mjs'))
  copyFileSync(dispatcher, join(root, 'scripts/run-lefthook.mjs'))
  writeFileSync(
    join(scripts, 'typecheck-marker.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.DSH_TEST_TYPECHECK_MARKER, 'ran\\n')\n",
  )
  const config = options.oldConfig
    ? hookConfig().replace(/^lefthook: node scripts\/run-lefthook\.mjs\r?\n/mu, '').replace(/^      args: --from-git-hook-env\r?\n/mu, '')
    : hookConfig()
  writeFileSync(join(root, 'lefthook.yml'), config)
  writeFileSync(join(root, 'README.md'), '# isolated hook fixture\n')
  const env = Object.fromEntries(Object.entries(process.env).filter(
    ([key]) => !/^(?:GIT_|LEFTHOOK|DSH_GIT_PRE_PUSH_ARGS$)/iu.test(key),
  ))
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: join(container, 'global.gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Hook Fixture',
    GIT_AUTHOR_EMAIL: 'hook@example.test',
    GIT_COMMITTER_NAME: 'Hook Fixture',
    GIT_COMMITTER_EMAIL: 'hook@example.test',
    HOME: container,
    XDG_CONFIG_HOME: join(container, '.config'),
    DSH_TEST_TYPECHECK_MARKER: marker,
    NO_COLOR: '1',
  })
  const fixture = { root, marker, sentinel, env, head: '' }
  checked(fixture, 'git', ['init', '-q'])
  checked(fixture, 'git', ['add', 'README.md', 'lefthook.yml', 'scripts', '.lefthook'])
  checked(fixture, 'git', ['-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'])
  fixture.head = checked(fixture, 'git', ['rev-parse', 'HEAD'])
  checked(fixture, process.execPath, [lefthookEntrypoint, 'install', '--force'])
  return fixture
}

function runFixtureHook(fixture: HookFixture, args: string[], extraEnv: NodeJS.ProcessEnv = {}, emptyPush = false) {
  const remoteHead = emptyPush ? fixture.head : '0'.repeat(40)
  const input = `refs/heads/main ${fixture.head} refs/heads/main ${remoteHead}\n`
  return command({ ...fixture, env: { ...fixture.env, ...extraEnv } }, 'git', ['hook', 'run', 'pre-push', '--', ...args], input)
}

function expectHookResult(fixture: HookFixture, result: ReturnType<typeof command>, status: number, diagnostic?: string) {
  const output = result.stdout + result.stderr
  expect.soft(result.status, output).toBe(status)
  expect.soft(existsSync(fixture.marker), output).toBe(status === 0)
  expect.soft(existsSync(fixture.sentinel), output).toBe(false)
  if (diagnostic !== undefined) expect.soft(output).toContain(diagnostic)
}

describe('push destination normalization', () => {
  for (const location of [
    'https://github.com/Biyocon/deepseek-harness.git',
    'https://github.com/biyocon/deepseek-harness/',
    'git@github.com:Biyocon/deepseek-harness.git',
    'ssh://git@github.com/Biyocon/deepseek-harness.git',
  ]) {
    it(`accepts ${location}`, () => {
      expect(normalizePushRepository(location)).toBe(ALLOWED_PUSH_REPOSITORY)
      expect(validatePushDestination(['biyocon', location])).toEqual({
        remoteName: 'biyocon',
        repository: ALLOWED_PUSH_REPOSITORY,
      })
    })
  }

  for (const location of [
    'https://github.com/deepseek-ai/deepseek-harness.git',
    'git@github.com:deepseek-ai/deepseek-harness.git',
    'https://github.com/another/deepseek-harness.git',
    'https://github.com/Biyocon/another.git',
    'https://github.com/Biyocon/deepseek-harness.git?ref=master',
    'file:///tmp/deepseek-harness',
    'DISABLED_no_push_to_upstream',
  ]) {
    it(`rejects ${location}`, () => {
      expect(() => validatePushDestination(['biyocon', location])).toThrow()
    })
  }

  it('validates the location instead of trusting the remote name', () => {
    expect(() => validatePushDestination([
      'biyocon',
      'https://github.com/deepseek-ai/deepseek-harness.git',
    ])).toThrow(/deepseek-ai\/deepseek-harness/u)
    expect(validatePushDestination([
      'renamed-fork',
      'https://github.com/Biyocon/deepseek-harness.git',
    ])).toEqual({ remoteName: 'renamed-fork', repository: ALLOWED_PUSH_REPOSITORY })
  })

  for (const location of [
    'https:/github.com/Biyocon/deepseek-harness.git',
    'https:github.com/Biyocon/deepseek-harness.git',
    'https:///github.com/Biyocon/deepseek-harness.git',
    'https://github.com/Biyocon\\deepseek-harness.git',
    'https://%67ithub.com/Biyocon/deepseek-harness.git',
    'https://github.com/another/../Biyocon/deepseek-harness.git',
    'https://github.com/another/%2e%2e/Biyocon/deepseek-harness.git',
    'ssh:/git@github.com/Biyocon/deepseek-harness.git',
    'httpſ://github.com/Biyocon/deepseek-harness.git',
    'ſsh://git@github.com/Biyocon/deepseek-harness.git',
  ]) {
    it(`rejects unsupported syntax in ${location}`, () => {
      expect(normalizePushRepository(location)).toBeUndefined()
      expect(() => validatePushDestination(['biyocon', location])).toThrow(/not an unambiguous/u)
    })
  }

  for (const [label, character] of [
    ['NUL', '\u0000'],
    ['tab', '\t'],
    ['newline', '\n'],
    ['carriage return', '\r'],
    ['unit separator', '\u001f'],
    ['DEL', '\u007f'],
  ] as const) {
    it(`rejects an embedded ASCII ${label} character before URL parsing`, () => {
      const location = `https://github.com/Biyocon/deepseek-${character}harness.git`
      expect(normalizePushRepository(location)).toBeUndefined()
      expect(() => validatePushDestination(['biyocon', location])).toThrow(/not an unambiguous/u)
    })
  }

  it('rejects direct URL pushes and incomplete hook arguments', () => {
    const location = 'https://github.com/Biyocon/deepseek-harness.git'
    expect(() => validatePushDestination([location, location])).toThrow(/direct URL pushes/u)
    expect(() => validatePushDestination([])).toThrow(/expected Git pre-push arguments/u)
    expect(() => validatePushDestination(['biyocon'])).toThrow(/expected Git pre-push arguments/u)
    expect(() => validatePushDestination(['biyocon', ''])).toThrow(/expected Git pre-push arguments/u)
  })
})

describe('installed pre-push hook', { timeout: 30_000 }, () => {
  for (const location of [fork, 'git@github.com:Biyocon/deepseek-harness.git', 'ssh://git@github.com/Biyocon/deepseek-harness.git']) {
    it(`runs typecheck for ${location} with nonempty push files`, () => {
      const fixture = createHookFixture()
      expectHookResult(fixture, runFixtureHook(fixture, ['renamed-fork', location]), 0)
    })
  }

  for (const [label, args, diagnostic] of [
    ['upstream', ['origin', upstream], 'is not allowed'],
    ['malformed HTTPS', ['biyocon', 'https:/github.com/Biyocon/deepseek-harness.git'], 'not an unambiguous'],
    ['direct URL', [fork, fork], 'direct URL pushes'],
    ['missing arguments', [], 'expected Git pre-push arguments'],
    ['missing location', ['biyocon'], 'expected Git pre-push arguments'],
    ['extra argument', ['biyocon', fork, 'unexpected'], 'expected Git pre-push arguments'],
  ] satisfies [string, string[], string][]) {
    it(`rejects ${label} before typecheck`, () => {
      const fixture = createHookFixture()
      expectHookResult(fixture, runFixtureHook(fixture, args), 1, diagnostic)
    })
  }

  it('rejects a hostile URL without running the injected command', () => {
    const fixture = createHookFixture()
    const path = fixture.sentinel.replaceAll('\\', '/')
    const location = `${fork};node -e "require('node:fs').writeFileSync('${path}', 'bad')"`
    expectHookResult(fixture, runFixtureHook(fixture, ['origin', location]), 1, 'not an unambiguous')
  })

  for (const [label, location] of [
    ['userinfo', 'https://dsh-synthetic-credential@github.com/Biyocon/deepseek-harness.git'],
    ['query', `${fork}?access_token=dsh-synthetic-credential`],
  ] as const) {
    for (const entry of ['validator CLI', 'installed hook']) {
      it(`omits credentials from rejected ${label} diagnostics through the ${entry}`, () => {
        const fixture = createHookFixture()
        const result = entry === 'validator CLI'
          ? command(fixture, process.execPath, [validator, 'biyocon', location])
          : runFixtureHook(fixture, ['biyocon', location])
        expectHookResult(fixture, result, 1, 'not an unambiguous')
        expect.soft(result.stdout).not.toContain('dsh-synthetic-credential')
        expect.soft(result.stderr).not.toContain('dsh-synthetic-credential')
      })
    }
  }

  for (const remoteName of [
    'x;true;#',
    'quoted\'"remote',
    "x$(node${IFS}-e${IFS}'require(\"node:fs\").writeFileSync(\"unexpected-command\",\"bad\")')",
    '--job=typecheck',
  ]) {
    for (const location of [fork, upstream]) {
      it(`treats remote name ${remoteName} as data for ${location}`, () => {
        const fixture = createHookFixture()
        expectHookResult(fixture, runFixtureHook(fixture, [remoteName, location]), location === fork ? 0 : 1)
      })
    }
  }

  it('rejects an upstream destination when no push files changed', () => {
    const fixture = createHookFixture()
    expectHookResult(fixture, runFixtureHook(fixture, ['origin', upstream], {}, true), 1, 'is not allowed')
  })

  for (const key of [transportKey, transportKey.toLowerCase()]) {
    for (const payload of [JSON.stringify(['biyocon', fork]), '{invalid-json']) {
      for (const location of [fork, upstream]) {
        it(`overwrites inherited ${key}=${payload} for ${location}`, () => {
          const fixture = createHookFixture()
          expectHookResult(fixture, runFixtureHook(fixture, ['origin', location], { [key]: payload }), location === fork ? 0 : 1)
        })
      }
    }
  }

  for (const payload of [undefined, '{invalid-json']) {
    it(`fails closed for a direct Lefthook invocation with transport ${String(payload)}`, () => {
      const fixture = createHookFixture()
      const result = command({ ...fixture, env: { ...fixture.env, [transportKey]: payload } }, process.execPath, [lefthookEntrypoint, 'run', 'pre-push'])
      expectHookResult(fixture, result, 1)
      expect.soft(result.stdout + result.stderr).toContain('[verify-push-destination]')
    })
  }

  it('fails closed when LEFTHOOK_BIN selects the real binary without transport', () => {
    const fixture = createHookFixture()
    expectHookResult(fixture, runFixtureHook(fixture, ['biyocon', fork], { LEFTHOOK_BIN: nativeLefthook }), 1, 'missing Git pre-push argument transport')
  })

  it('rejects an old generated hook with new config until the dispatcher is installed', () => {
    const fixture = createHookFixture({ oldConfig: true })
    const hook = join(fixture.root, '.git/hooks/pre-push')
    expect(readFileSync(hook, 'utf8')).not.toContain('node scripts/run-lefthook.mjs')
    writeFileSync(join(fixture.root, 'lefthook.yml'), hookConfig())
    expectHookResult(fixture, runFixtureHook(fixture, ['biyocon', fork]), 1, 'missing Git pre-push argument transport')
    checked(fixture, process.execPath, [lefthookEntrypoint, 'install', '--force'])
    expect(readFileSync(hook, 'utf8')).toContain('node scripts/run-lefthook.mjs')
    expectHookResult(fixture, runFixtureHook(fixture, ['biyocon', fork]), 0)
  })
})

describe('pre-push argument transport parsing', () => {
  for (const payload of [undefined, '{invalid-json', '{}', 'null', '["biyocon",1]', '[]', '["biyocon"]', JSON.stringify(['biyocon', fork, 'extra'])]) {
    it(`rejects missing or invalid transport ${String(payload)}`, () => {
      const fixture = createHookFixture()
      const result = command({ ...fixture, env: { ...fixture.env, [transportKey]: payload } }, process.execPath, [validator, '--from-git-hook-env'])
      expectHookResult(fixture, result, 1)
      expect.soft(result.stdout + result.stderr).toContain('[verify-push-destination]')
    })
  }

  it('rejects extra mode arguments even when the transport payload is valid', () => {
    const fixture = createHookFixture()
    const result = command(
      { ...fixture, env: { ...fixture.env, [transportKey]: JSON.stringify(['biyocon', fork]) } },
      process.execPath,
      [validator, '--from-git-hook-env', 'unexpected'],
    )
    expectHookResult(fixture, result, 1, 'missing Git pre-push argument transport')
  })

  it('keeps the direct validator CLI available', () => {
    const fixture = createHookFixture()
    const result = command(fixture, process.execPath, [validator, 'biyocon', fork])
    expect.soft(result.status, result.stdout + result.stderr).toBe(0)
    expect.soft(existsSync(fixture.marker)).toBe(false)
  })
})
