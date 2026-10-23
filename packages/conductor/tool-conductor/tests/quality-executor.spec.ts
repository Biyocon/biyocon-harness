import { PassThrough } from 'node:stream'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import {
  ConductorRunId,
  QualityCommandId,
  createRun,
  executionBaselineHash,
  executionEffectProfile,
} from '@deepseek-ai/dsh-conductor'
import type { ConductorRun, QualityExecutionRecord } from '@deepseek-ai/dsh-conductor'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxEnforcement, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SessionId } from '@deepseek-ai/dsh-session'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it } from 'vitest'
import { qualityToolContribution } from '../src/quality-executor.ts'
import type { QualityToolScope } from '../src/quality-executor.ts'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import { resolveQualityCatalog } from '../src/quality-catalog.ts'
import type { QualityCommandConfig } from '../src/quality-catalog.ts'

class RecordingSandbox extends SandboxProvider {
  enforcement: SandboxEnforcement = 'full'
  lastPolicy: SandboxPolicy | undefined
  confineError: Error | undefined
  onConfine: (() => void) | undefined
  denialSignatures = ['permission denied']
  runnerFailureRules: ConfinedArgv['runnerFailureRules'] = []
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv {
    if (this.confineError !== undefined) throw this.confineError
    this.lastPolicy = policy
    this.onConfine?.()
    return {
      argv: ['sandbox-runner', ...argv],
      enforcement: this.enforcement,
      denialSignatures: this.denialSignatures,
      runnerFailureRules: this.runnerFailureRules,
    }
  }
}

class RecordingSubprocess extends SubprocessRuntime {
  lastSpec: SubprocessSpawnSpec | undefined
  exitCode: number | null = 0
  signal: NodeJS.Signals | null = null
  stdout = 'checks passed'
  stderr = ''
  spawnError: Error | undefined
  doneError: Error | undefined
  rejectOnAbort = false
  completeOnAbort = false
  omitOutput = false
  lossy = false
  waitForExitCalls = 0
  resolveExecutable(command: string): Promise<string> { return Promise.resolve(command) }
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    if (spec.signal?.aborted === true) throw new Error(`aborted before spawn: ${String(spec.signal.reason ?? 'aborted')}`)
    if (this.spawnError !== undefined) throw this.spawnError
    this.lastSpec = spec
    const read = (text: string): SubprocessOutputRead => ({ text, nextOffset: text.length, lossy: this.lossy })
    const done = this.doneError !== undefined
      ? Promise.reject(this.doneError)
      : this.rejectOnAbort
        ? new Promise<never>((_resolve, reject) => {
          if (spec.signal === undefined) throw new Error('expected an execution signal')
          const signal = spec.signal
          signal.addEventListener('abort', () => {
            const reason: unknown = signal.reason
            reject(reason instanceof Error ? reason : new Error(String(reason)))
          }, { once: true })
        })
        : this.completeOnAbort
          ? new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve) => {
            spec.signal!.addEventListener('abort', () => { resolve({ exitCode: 0, signal: null }) }, { once: true })
          })
          : Promise.resolve({ exitCode: this.exitCode, signal: this.signal })
    return {
      pid: 1,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: this.omitOutput ? {} : {
        stdout: { readFrom: () => read(this.stdout) },
        stderr: { readFrom: () => read(this.stderr) },
      },
      done,
      terminate: () => {},
      waitForExit: () => {
        this.waitForExitCalls += 1
        return Promise.resolve(true)
      },
    }
  }
  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.resolve({
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: () => Promise.resolve(),
      inspectForeground: () => Promise.resolve({ processGroupId: 1, inputWaiting: true }),
      signalForeground: () => Promise.resolve(1),
      terminate: () => Promise.resolve(),
    })
  }
}

function spawnFailure(code: 'EACCES' | 'ENOENT', program = 'sandbox-runner'): Error {
  return Object.assign(new Error(`spawn ${program} ${code}`), {
    code,
    path: program,
    syscall: `spawn ${program}`,
  })
}

async function setup(commandOverrides: Partial<QualityCommandConfig> = {}, cwd = process.cwd()) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(RecordingSandbox)
  await ctx.plugin(RecordingSubprocess)
  const agent = ctx.agentLoop.create(
    SessionId('quality-parent'),
    { provider: 'unused', model: 'unused' },
    { cwd },
  )
  const catalog = resolveQualityCatalog([{
    id: 'unit-check',
    modelSafeDescription: 'Run unit checks.',
    argv: ['node', '--version'],
    cwd: '.',
    allowedStages: ['headsman', 'auditor'],
    sandboxMode: 'read-only',
    timeoutMs: 1000,
    maxOutputBytes: 4096,
    graceMs: 100,
    ...commandOverrides,
  }])
  const definition = catalog.get('unit-check')!
  const binding = {
    id: QualityCommandId('unit-check'),
    definitionHash: definition.definitionHash,
    requiredGates: ['D', 'E'] as Array<'D' | 'E'>,
  }
  const base = createRun(ConductorRunId('CON-2026-0001'), {
    objective: 'verify',
    authority: { owner: 'user' },
    acceptanceCriteria: ['checks pass'],
  })
  const baseline = {
    scopeVersion: 'scope-1',
    planVersion: 'plan-1',
    acceptanceVersion: 'accept-1',
    allowedPaths: [],
    excludedPaths: [],
    rollbackReference: 'HEAD',
    qualityCommands: [binding],
  }
  const run: ConductorRun = {
    ...base,
    sourceBaseline: 'HEAD',
    currentStage: 'headsman',
    baselineHistory: [baseline],
    baseline,
    executionAuthorization: {
      executionBaselineHash: executionBaselineHash(baseline),
      effectProfile: executionEffectProfile(baseline),
    },
  }
  const records: QualityExecutionRecord[] = []
  const requiredBindings = [binding]
  const scope: QualityToolScope = {
    run,
    policyStage: 'headsman',
    executorStage: 'headsman',
    gate: 'D',
    cycle: 1,
    catalog,
    requiredBindings,
    records,
    sandbox: ctx.sandbox,
    subprocess: ctx.subprocess,
  }
  const dispose = qualityToolContribution(scope)(agent.ctx)
  return {
    ctx,
    agent,
    run,
    records,
    binding,
    requiredBindings,
    scope,
    dispose,
    sandbox: ctx.sandbox as RecordingSandbox,
    subprocess: ctx.subprocess as RecordingSubprocess,
  }
}

describe('Conductor quality executor', () => {
  it('rejects unknown, unbound, and stage-inapplicable command ids before confinement', async () => {
    for (const variant of ['unknown', 'unbound', 'stage'] as const) {
      const { ctx, agent, run, requiredBindings, dispose, sandbox } = await setup()
      if (variant === 'unbound') run.baseline!.qualityCommands = []
      if (variant === 'stage') requiredBindings.length = 0
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId(`quality-${variant}`),
        name: 'conductor_quality_check', arguments: { command_id: variant === 'unknown' ? 'unknown' : 'unit-check' }, agent,
      })
      expect(result.isError).toBe(true)
      expect(sandbox.lastPolicy).toBeUndefined()
      dispose()
    }
  })

  it('requires a child agent and its workspace before confinement', async () => {
    const { ctx, agent, dispose, sandbox } = await setup()
    const noWorkspace = ctx.agentLoop.create(SessionId('quality-no-workspace'), { provider: 'unused', model: 'unused' })
    for (const target of [undefined, noWorkspace]) {
      const exec = {
        signal: new AbortController().signal, callId: CallId('quality-missing-context'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' },
        ...target === undefined ? {} : { agent: target },
      } as ToolRunContext
      await expect(ctx.tools.get('conductor_quality_check', agent)!.execute({ command_id: 'unit-check' }, exec))
        .rejects.toThrow(target === undefined ? /requires a child agent/ : /requires a session workspace/)
      expect(sandbox.lastPolicy).toBeUndefined()
    }
    dispose()
  })

  it('requires a baseline before installing the child tool and matching effects before spawning', async () => {
    const { ctx, agent, run, scope, dispose, sandbox } = await setup()
    expect(() => qualityToolContribution({ ...scope, run: { ...run, baseline: null } })).toThrow(/Gate C baseline/)
    for (const effectProfile of [
      { filesystem: 'workspace-write', quality: 'catalog', external: 'none' },
      { filesystem: 'read-only', quality: 'none', external: 'none' },
    ] as const) {
      run.executionAuthorization = { executionBaselineHash: executionBaselineHash(run.baseline!), effectProfile }
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId('quality-wrong-effects'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toMatch(/host-authorized effect profile/)
      expect(sandbox.lastPolicy).toBeUndefined()
    }
    dispose()
  })

  it('enforces canonical write roots, including both directions of excluded-path overlap', async () => {
    for (const variant of ['allowed', 'outside', 'excluded-child', 'excluded-parent'] as const) {
      const { ctx, agent, run, dispose, sandbox, subprocess } = await setup({
        sandboxMode: 'workspace-write', writeRoot: 'packages/conductor', allowedStages: ['headsman'],
      })
      const baseline = run.baseline!
      baseline.allowedPaths = [variant === 'outside' ? 'packages/core' : 'packages/conductor']
      baseline.excludedPaths = variant === 'excluded-child' ? ['packages/conductor/private']
        : variant === 'excluded-parent' ? ['packages'] : ['docs']
      run.executionAuthorization = {
        executionBaselineHash: executionBaselineHash(baseline), effectProfile: executionEffectProfile(baseline),
      }
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId(`quality-write-${variant}`),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.isError, JSON.stringify(result)).toBe(variant !== 'allowed')
      expect(subprocess.lastSpec !== undefined).toBe(variant === 'allowed')
      if (variant === 'allowed') expect(sandbox.lastPolicy).toMatchObject({ mode: 'workspace-write', network: 'deny' })
      dispose()
    }
  })

  it('rejects a configured cwd that escapes through a workspace symlink', async () => {
    const root = mkdtempSync(join(tmpdir(), 'quality-cwd-'))
    try {
      const workspace = join(root, 'workspace')
      const outside = join(root, 'outside')
      mkdirSync(workspace)
      mkdirSync(outside)
      symlinkSync(outside, join(workspace, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
      const { ctx, agent, dispose, subprocess } = await setup({ cwd: 'alias' }, workspace)
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId('quality-cwd-escape'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.isError).toBe(true)
      expect(subprocess.lastSpec).toBeUndefined()
      dispose()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('preserves absent or truncated process output as separate execution facts', async () => {
    for (const omitOutput of [true, false]) {
      const { ctx, agent, records, dispose, subprocess } = await setup()
      subprocess.omitOutput = omitOutput
      subprocess.lossy = true
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId('quality-output'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.value).toMatchObject({ stdout: omitOutput ? '' : 'checks passed', stdoutTruncated: !omitOutput })
      expect(records[0]).toMatchObject({ outcome: 'passed', stdoutTruncated: !omitOutput, stderrTruncated: !omitOutput })
      dispose()
    }
  })

  it('reports cancellation or timeout even when the terminated process exits zero', async () => {
    for (const timedOut of [true, false]) {
      const { ctx, agent, records, dispose, sandbox, subprocess } = await setup({ timeoutMs: timedOut ? 5 : 1000 })
      const controller = new AbortController()
      subprocess.completeOnAbort = true
      if (!timedOut) sandbox.onConfine = () => { queueMicrotask(() => { controller.abort(new Error('cancelled')) }) }
      const result = await ctx.tools.execute({
        signal: controller.signal, callId: CallId('quality-zero-after-abort'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.isError).toBe(!timedOut)
      expect(records[0]).toMatchObject({ outcome: 'failed', failure: timedOut ? 'timeout' : 'cancelled', exitCode: 0 })
      dispose()
    }
  })

  it('bounds multibyte diagnostics without emitting invalid UTF-8', async () => {
    for (const maxOutputBytes of [1, 4]) {
      const { ctx, agent, dispose, sandbox } = await setup({ maxOutputBytes })
      sandbox.confineError = new Error('')
      sandbox.confineError.toString = () => '€€'
      const result = await ctx.tools.execute({
        signal: new AbortController().signal, callId: CallId('quality-utf8'),
        name: 'conductor_quality_check', arguments: { command_id: 'unit-check' }, agent,
      })
      expect(result.value).toMatchObject({ stderr: maxOutputBytes === 1 ? '' : '€', stderrTruncated: true })
      dispose()
    }
  })

  it('runs only catalog argv under full confinement and emits host-owned evidence', async () => {
    const { ctx, agent, records, dispose, subprocess } = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-success'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(records).toHaveLength(1)
    expect(records[0], JSON.stringify(result)).toMatchObject({ commandId: 'unit-check', gate: 'D', cycle: 1, outcome: 'passed', exitCode: 0 })
    expect(subprocess.lastSpec?.argv).toEqual(['sandbox-runner', 'node', '--version'])
    expect((ctx.sandbox as RecordingSandbox).lastPolicy).toMatchObject({ mode: 'read-only', network: 'deny' })
    expect(JSON.stringify(records[0])).not.toContain('checks passed')
    dispose()
  })

  it('fails closed before spawn when the sandbox reports partial enforcement', async () => {
    const { ctx, agent, records, dispose, sandbox, subprocess } = await setup()
    sandbox.enforcement = 'partial'
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-partial'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(subprocess.lastSpec).toBeUndefined()
    expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'sandbox-unavailable' })
    dispose()
  })

  it('records nonzero exit as failed evidence', async () => {
    const { ctx, agent, records, dispose, subprocess } = await setup()
    subprocess.exitCode = 2
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-nonzero'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'nonzero-exit', exitCode: 2 })
    dispose()
  })

  it('rejects extra raw command fields before confinement', async () => {
    const { ctx, agent, records, dispose, sandbox, subprocess } = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-extra-argv'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check', argv: ['pwsh', '-Command', 'unsafe'] },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    if (result.content[0]?.type !== 'text') throw new Error('expected text error')
    expect(result.content[0].text).toMatch(/only command_id/)
    expect(sandbox.lastPolicy).toBeUndefined()
    expect(subprocess.lastSpec).toBeUndefined()
    expect(records).toEqual([])
    dispose()
  })

  it('rejects a catalog definition that drifted after Gate C', async () => {
    const { ctx, agent, run, records, dispose, subprocess } = await setup()
    if (run.baseline === null || run.baseline.qualityCommands[0] === undefined) throw new Error('missing test binding')
    run.baseline.qualityCommands[0].definitionHash = 'b'.repeat(64)
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-drift'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    if (result.content[0]?.type !== 'text') throw new Error('expected text error')
    expect(result.content[0].text).toMatch(/definition changed/)
    expect(subprocess.lastSpec).toBeUndefined()
    expect(records).toEqual([])
    dispose()
  })

  it('rejects missing or stale host authorization before confinement', async () => {
    for (const authorization of [null, {
      executionBaselineHash: 'f'.repeat(64),
      effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' } as const,
    }]) {
      const { ctx, agent, run, records, dispose, sandbox, subprocess } = await setup()
      run.executionAuthorization = authorization
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId('quality-unauthorized'),
        name: 'conductor_quality_check',
        arguments: { command_id: 'unit-check' },
        agent,
      })
      expect(result.isError).toBe(true)
      expect(sandbox.lastPolicy).toBeUndefined()
      expect(subprocess.lastSpec).toBeUndefined()
      expect(records).toEqual([])
      dispose()
    }
  })

  it('rejects workspace-write commands when the host authorized read-only filesystem effects', async () => {
    const { ctx, agent, run, records, dispose, sandbox, subprocess } = await setup({
      sandboxMode: 'workspace-write', writeRoot: '.', allowedStages: ['headsman'],
    })
    if (run.executionAuthorization === null) throw new Error('missing test authorization')
    run.executionAuthorization.effectProfile.filesystem = 'read-only'
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-write-unauthorized'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(true)
    expect(sandbox.lastPolicy).toBeUndefined()
    expect(subprocess.lastSpec).toBeUndefined()
    expect(records).toEqual([])
    dispose()
  })

  it('classifies sandbox denials, runner failures, and signals without persisting output', async () => {
    for (const scenario of [
      { id: 'denied', exitCode: 3, signal: null, stderr: 'Permission denied by profile', failure: 'denied' },
      { id: 'runner', exitCode: 125, signal: null, stderr: 'runner fatal', failure: 'runner-failure', runner: true },
      { id: 'signal', exitCode: null, signal: 'SIGTERM', stderr: '', failure: 'signal' },
    ] as const) {
      const { ctx, agent, records, dispose, sandbox, subprocess } = await setup()
      subprocess.exitCode = scenario.exitCode
      subprocess.signal = scenario.signal
      subprocess.stderr = scenario.stderr
      if ('runner' in scenario) {
        sandbox.runnerFailureRules = [{ allowedExitCodes: [125], fatalSignatures: ['runner fatal'] }]
      }
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`quality-${scenario.id}`),
        name: 'conductor_quality_check',
        arguments: { command_id: 'unit-check' },
        agent,
      })
      expect(result.isError).toBe(false)
      expect(records[0]).toMatchObject({ outcome: 'failed', failure: scenario.failure, signal: scenario.signal })
      if (scenario.stderr.length > 0) expect(JSON.stringify(records[0])).not.toContain(scenario.stderr)
      dispose()
    }
  })

  it('records a bounded timeout only after process-tree quiescence', async () => {
    const { ctx, agent, records, dispose, subprocess } = await setup({ timeoutMs: 5 })
    subprocess.rejectOnAbort = true
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-timeout'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(subprocess.waitForExitCalls).toBe(1)
    expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'timeout' })
    dispose()
  })

  it('records pre-spawn cancellation when the subprocess rejects an already-aborted signal', async () => {
    const { ctx, agent, records, dispose, sandbox, subprocess } = await setup()
    const controller = new AbortController()
    sandbox.onConfine = () => { controller.abort(new Error('caller cancelled')) }
    const result = await ctx.tools.execute({
      signal: controller.signal,
      callId: CallId('quality-cancelled-before-spawn'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result).toMatchObject({ isError: true, error: { info: { code: 'ABORTED' } } })
    expect(subprocess.lastSpec).toBeUndefined()
    expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'cancelled' })
    dispose()
  })

  it('classifies exact sandbox-runner spawn failures from both provider delivery forms', async () => {
    for (const scenario of [
      { id: 'sync-enoent', delivery: 'sync', error: spawnFailure('ENOENT') },
      { id: 'done-eacces', delivery: 'done', error: spawnFailure('EACCES') },
    ] as const) {
      const { ctx, agent, records, dispose, subprocess } = await setup()
      if (scenario.delivery === 'sync') subprocess.spawnError = scenario.error
      else subprocess.doneError = scenario.error
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`quality-${scenario.id}`),
        name: 'conductor_quality_check',
        arguments: { command_id: 'unit-check' },
        agent,
      })
      expect(result.isError).toBe(false)
      expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'sandbox-unavailable' })
      expect(subprocess.waitForExitCalls).toBe(scenario.delivery === 'done' ? 1 : 0)
      dispose()
    }
  })

  it('keeps unproven spawn errors classified as runner failures', async () => {
    for (const scenario of [
      { id: 'generic-sync', delivery: 'sync', error: new Error('provider failed') },
      { id: 'wrong-program-done', delivery: 'done', error: spawnFailure('ENOENT', 'catalog-command') },
    ] as const) {
      const { ctx, agent, records, dispose, subprocess } = await setup()
      if (scenario.delivery === 'sync') subprocess.spawnError = scenario.error
      else subprocess.doneError = scenario.error
      const result = await ctx.tools.execute({
        signal: new AbortController().signal,
        callId: CallId(`quality-${scenario.id}`),
        name: 'conductor_quality_check',
        arguments: { command_id: 'unit-check' },
        agent,
      })
      expect(result.isError).toBe(false)
      expect(records[0]).toMatchObject({ outcome: 'failed', failure: 'runner-failure' })
      expect(subprocess.waitForExitCalls).toBe(scenario.delivery === 'done' ? 1 : 0)
      dispose()
    }
  })

  it('bounds infrastructure diagnostics and keeps them out of durable records', async () => {
    const { ctx, agent, records, dispose, sandbox } = await setup({ maxOutputBytes: 8 })
    sandbox.confineError = new Error('diagnostic that is longer than the configured output budget')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: CallId('quality-bounded-error'),
      name: 'conductor_quality_check',
      arguments: { command_id: 'unit-check' },
      agent,
    })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ failure: 'sandbox-unavailable', stderrTruncated: true })
    expect((result.value as { stderr: string }).stderr.length).toBeLessThanOrEqual(8)
    expect(JSON.stringify(records[0])).not.toContain('diagnostic')
    dispose()
  })
})
