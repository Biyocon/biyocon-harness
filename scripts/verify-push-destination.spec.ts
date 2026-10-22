import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ALLOWED_PUSH_REPOSITORY,
  normalizePushRepository,
  validatePushDestination,
} from '../.lefthook/pre-push/verify-push-destination.mjs'

const validator = fileURLToPath(new URL('../.lefthook/pre-push/verify-push-destination.mjs', import.meta.url))
const lefthookPackage = fileURLToPath(import.meta.resolve('lefthook/package.json'))
const lefthookEntrypoint = join(dirname(lefthookPackage), 'bin/index.js')
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { force: true, recursive: true })
})

function createHookFixture(): { marker: string; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-push-guard-'))
  fixtures.push(root)
  const scripts = join(root, '.lefthook/pre-push')
  const marker = join(root, 'typecheck-ran')
  mkdirSync(scripts, { recursive: true })
  copyFileSync(validator, join(scripts, 'verify-push-destination.mjs'))
  writeFileSync(
    join(scripts, 'typecheck-marker.mjs'),
    "import { writeFileSync } from 'node:fs'\nwriteFileSync(process.env.DSH_TEST_TYPECHECK_MARKER, 'ran\\n')\n",
  )
  writeFileSync(join(root, 'lefthook.yml'), `pre-push:
  piped: true
  jobs:
    - name: push destination
      script: verify-push-destination.mjs
      runner: node
    - name: typecheck
      script: typecheck-marker.mjs
      runner: node
`)
  const initialized = spawnSync('git', ['init'], { cwd: root, encoding: 'utf8' })
  if (initialized.status !== 0) throw new Error(initialized.stderr)
  return { marker, root }
}

function runFixtureHook(root: string, marker: string, args: string[]) {
  return spawnSync(process.execPath, [lefthookEntrypoint, 'run', 'pre-push', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, DSH_TEST_TYPECHECK_MARKER: marker },
  })
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
  ]) {
    it(`rejects URL repair for ${location}`, () => {
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

describe('pre-push job ordering', () => {
  it('rejects an SCP-looking HTTPS location before typecheck', () => {
    const { marker, root } = createHookFixture()
    const result = runFixtureHook(root, marker, [
      'biyocon',
      'https:/github.com/Biyocon/deepseek-harness.git',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('not an unambiguous')
    expect(existsSync(marker)).toBe(false)
  })

  it('stops before typecheck when the destination is rejected', () => {
    const { marker, root } = createHookFixture()
    const result = runFixtureHook(root, marker, [
      'origin',
      'https://github.com/deepseek-ai/deepseek-harness.git',
    ])

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('is not allowed')
    expect(existsSync(marker)).toBe(false)
  })

  it('continues to typecheck only for the named Biyocon destination', () => {
    const { marker, root } = createHookFixture()
    const result = runFixtureHook(root, marker, [
      'biyocon',
      'git@github.com:Biyocon/deepseek-harness.git',
    ])

    expect(result.status, result.stderr).toBe(0)
    expect(existsSync(marker)).toBe(true)
  })

  it('passes hostile-looking arguments as data without executing them', () => {
    const { marker, root } = createHookFixture()
    const sentinel = join(root, 'unexpected-command')
    const result = runFixtureHook(root, marker, [
      'origin',
      `https://github.com/Biyocon/deepseek-harness.git;node -e "require('node:fs').writeFileSync('${sentinel}', 'bad')"`,
    ])

    expect(result.status).toBe(1)
    expect(existsSync(marker)).toBe(false)
    expect(existsSync(sentinel)).toBe(false)
  })
})
