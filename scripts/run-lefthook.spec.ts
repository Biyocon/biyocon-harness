import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { removeFixtureSafely } from './test-fixture-cleanup.ts'

const dispatcher = fileURLToPath(new URL('./run-lefthook.mjs', import.meta.url))
const transportKey = 'DSH_GIT_PRE_PUSH_ARGS'
const fixtures: string[] = []
const fork = 'https://github.com/Biyocon/deepseek-harness.git'

interface DispatcherFixture {
  root: string
  entrypoint: string
  env: NodeJS.ProcessEnv
}

interface ChildReport {
  args: string[]
  execArgv: string[]
  transport: Record<string, string>
  stdin: string
  preloaded: boolean
}

afterEach(() => {
  for (const root of fixtures.splice(0)) removeFixtureSafely(root)
})

function createFixture(childSource?: string): DispatcherFixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-lefthook-dispatch-'))
  fixtures.push(root)
  mkdirSync(join(root, 'scripts'))
  const packageRoot = join(root, 'node_modules/lefthook')
  mkdirSync(join(packageRoot, 'bin'), { recursive: true })
  const entrypoint = join(root, 'scripts/run-lefthook.mjs')
  copyFileSync(dispatcher, entrypoint)
  writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({
    name: 'lefthook',
    type: 'module',
    bin: { lefthook: 'bin/record-child.mjs' },
  }))
  writeFileSync(join(packageRoot, 'bin/record-child.mjs'), childSource ?? `
import { readFileSync } from 'node:fs'
const transport = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() === '${transportKey}'))
process.stdout.write(JSON.stringify({ args: process.argv.slice(2), execArgv: process.execArgv, transport, stdin: readFileSync(0, 'utf8'), preloaded: globalThis.dshDispatcherParentPreload === true }))
`)
  const env = Object.fromEntries(Object.entries(process.env).filter(
    ([key]) => key.toUpperCase() !== transportKey && key.toUpperCase() !== 'NODE_OPTIONS',
  ))
  return { root, entrypoint, env }
}

function run(fixture: DispatcherFixture, args: string[], options: { env?: NodeJS.ProcessEnv; input?: string; nodeArgs?: string[] } = {}) {
  return spawnSync(process.execPath, [...(options.nodeArgs ?? []), fixture.entrypoint, ...args], {
    cwd: fixture.root,
    env: { ...fixture.env, ...options.env },
    encoding: 'utf8',
    input: options.input ?? '',
  })
}

function report(result: ReturnType<typeof run>): ChildReport {
  expect(result.status, result.stdout + result.stderr).toBe(0)
  return JSON.parse(result.stdout) as ChildReport
}

describe('Lefthook dispatcher process', () => {
  it('sends only fixed pre-push child arguments and transports every Git argument as JSON', () => {
    const fixture = createFixture()
    const gitArgs = ['--job=typecheck', fork, 'extra "quoted" $() ; argument']
    const child = report(run(fixture, ['run', 'pre-push', ...gitArgs]))
    expect(child.args).toEqual(['run', 'pre-push'])
    expect(child.transport).toEqual({ [transportKey]: JSON.stringify(gitArgs) })
    expect(child.execArgv).toEqual([])
  })

  it('transports an empty pre-push invocation without inheriting stale data', () => {
    const fixture = createFixture()
    const child = report(run(fixture, ['run', 'pre-push'], {
      env: { [transportKey]: JSON.stringify(['biyocon', fork]), [transportKey.toLowerCase()]: '{invalid-json' },
    }))
    expect(child.args).toEqual(['run', 'pre-push'])
    expect(child.transport).toEqual({ [transportKey]: '[]' })
  })

  for (const inherited of [JSON.stringify(['biyocon', fork]), '{invalid-json']) {
    it(`replaces all case variants of inherited transport ${inherited}`, () => {
      const fixture = createFixture()
      const child = report(run(fixture, ['run', 'pre-push', 'origin', 'https://github.com/deepseek-ai/deepseek-harness.git'], {
        env: { [transportKey]: inherited, [transportKey.toLowerCase()]: inherited },
      }))
      expect(child.transport).toEqual({ [transportKey]: JSON.stringify(['origin', 'https://github.com/deepseek-ai/deepseek-harness.git']) })
    })
  }

  for (const args of [
    ['run', 'pre-commit', 'name with spaces', '--job=lint', 'quote\'"$()'],
    ['install', '--force'],
    ['run', 'pre-push-extra', 'origin'],
  ]) {
    it(`forwards ${JSON.stringify(args)} and clears transport case-insensitively`, () => {
      const fixture = createFixture()
      const child = report(run(fixture, args, {
        env: { [transportKey]: 'stale', [transportKey.toLowerCase()]: 'invalid' },
      }))
      expect(child.args).toEqual(args)
      expect(child.transport).toEqual({})
    })
  }

  it('leaves pre-push stdin available to the maintained child entrypoint', () => {
    const fixture = createFixture()
    const input = `refs/heads/main ${'a'.repeat(40)} refs/heads/main ${'0'.repeat(40)}\nsecond line\n`
    expect(report(run(fixture, ['run', 'pre-push', 'biyocon', fork], { input })).stdin).toBe(input)
  })

  it('does not forward parent Node flags or import hooks to the child', () => {
    const fixture = createFixture()
    const preload = 'data:text/javascript,globalThis.dshDispatcherParentPreload=true'
    const child = report(run(fixture, ['run', 'pre-push', 'biyocon', fork], { nodeArgs: ['--import', preload] }))
    expect(child.execArgv).toEqual([])
    expect(child.preloaded).toBe(false)
  })

  it('preserves a nonzero child exit status', () => {
    const fixture = createFixture('process.exitCode = 77\n')
    const result = run(fixture, ['run', 'pre-push', 'biyocon', fork])
    expect(result.status, result.stderr).toBe(77)
  })

  it('fails when the child terminates on a signal', () => {
    const fixture = createFixture("process.kill(process.pid, 'SIGTERM')\n")
    const result = run(fixture, ['run', 'pre-push', 'biyocon', fork])
    expect(result.status, result.stderr).toBe(1)
  })

  it('reports a spawn failure and returns nonzero when no child status exists', () => {
    const fixture = createFixture()
    const nonexistentNode = join(fixture.root, 'nonexistent-node')
    const preload = `data:text/javascript,${encodeURIComponent(`Object.defineProperty(process, 'execPath', { value: ${JSON.stringify(nonexistentNode)} })`)}`
    const result = run(fixture, ['run', 'pre-push', 'biyocon', fork], { nodeArgs: ['--import', preload] })
    expect.soft(result.status, result.stderr).toBe(1)
    expect.soft(result.stderr).toContain('[run-lefthook]')
    expect.soft(result.stderr).toContain('ENOENT')
  })
})
