import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ConductorRunId, createRun, SessionConductorRunStore } from '@deepseek-ai/dsh-conductor'
import { CallId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentRun,
} from '@deepseek-ai/dsh-subagent'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { describe, expect, it, vi } from 'vitest'
import * as toolConductor from '../src/index.ts'
import { mountQualityServices } from './quality-services.ts'

const signal = new AbortController().signal
const roleSkills = [
  'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate',
  'conductor-headsman', 'conductor-auditor', 'conductor-integrator', 'conductor-arbiter',
  'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
]

function promptRunId(prompt: string): string {
  return /"run_id"\s*:\s*"(CON-\d{4}-\d{4})"/.exec(prompt)?.[1] ?? 'CON-0000-0000'
}

function readyEnvelope(runId: string, stage: string): Record<string, unknown> {
  return {
    run_id: runId,
    stage,
    baseline_ref: 'HEAD',
    ...(stage === 'detective' ? { source_baseline: 'HEAD' } : {}),
    status: 'ready',
    summary: `${stage} complete`,
    evidence: [{ kind: 'test', reference: `${stage}-check`, outcome: 'passed' }],
    findings: [], assumptions: [], blockers: [], artifacts: [], change_requests: [],
    quality_evidence_ids: [],
    recommended_transition: { target: 'conductor', rationale: 'evaluate' },
    confidence: 'high',
    ...(stage === 'devils-advocate' ? {
      execution_baseline: {
        scopeVersion: 'scope-v1', planVersion: 'plan-v1', acceptanceVersion: 'accept-v1',
        allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommandIds: [],
      },
    } : {}),
  }
}

type ResultFactory = (request: WorkflowStartRequest) => WorkflowResult

function successfulResult(request: WorkflowStartRequest): WorkflowResult {
  const args = request.args as { label: string; prompt: string }
  if (args.label === undefined) {
    return {
      stopReason: 'completed', agentsStarted: 1,
      value: {
        status: 'complete', roundsStarted: 1,
        report: { status: 'complete', summary: 'Ralph complete', evidence: ['focused test'], nextSteps: [], blocker: '' },
      },
    }
  }
  const runId = promptRunId(args.prompt)
  if (args.label === 'conductor-arbiter') {
    return {
      stopReason: 'completed', agentsStarted: 1,
      value: {
        run_id: runId, decision: 'go', basis: ['verified'], evidence_reviewed: ['delivery'],
        conditions: [], open_risks: [], required_follow_up: [],
      },
    }
  }
  return {
    stopReason: 'completed', agentsStarted: 1,
    value: readyEnvelope(runId, args.label.replace('conductor-', '')),
  }
}

class StubEngine extends WorkflowEngine {
  requests: WorkflowStartRequest[] = []
  disposed = 0
  factory: ResultFactory = successfulResult

  start(request: WorkflowStartRequest): WorkflowRun {
    this.requests.push(request)
    return {
      id: WorkflowRunId(`conductor-test-${this.requests.length}`),
      meta: request.meta,
      result: Promise.resolve(this.factory(request)),
      cancel: () => {},
      dispose: () => {
        this.disposed += 1
        return Promise.resolve()
      },
    }
  }
}

class StubProvider implements SubagentProvider {
  readonly name: string
  readonly capabilities: SubagentCapabilities
  readonly inheritsParentContext: boolean

  constructor(options: {
    name?: string
    capabilities?: Partial<SubagentCapabilities>
    inheritsParentContext?: boolean
  } = {}) {
    this.name = options.name ?? 'fresh'
    this.capabilities = {
      outputSchema: true,
      depthLimit: true,
      toolFilter: true,
      toolGuard: true,
      persona: true,
      toolContribution: true,
      ...options.capabilities,
    }
    this.inheritsParentContext = options.inheritsParentContext ?? false
  }

  start(_request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    return Promise.reject(new Error('StubProvider.start is owned by StubEngine in this test'))
  }
}

async function services(provider: SubagentProvider = new StubProvider()): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SubagentRuntime)
  ctx.subagents.registerProvider(provider)
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(StubEngine)
  await mountQualityServices(ctx)
  await ctx.plugin(UserApproval, { policy: 'ask' })
  ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  return ctx
}

async function setup(options: {
  config?: toolConductor.Config
  factory?: ResultFactory
  flush?: boolean
  skills?: readonly string[]
} = {}) {
  const providerName = options.config?.subagentProvider ?? (options.config === undefined ? 'fresh' : 'spawn')
  const ctx = await services(new StubProvider({ name: providerName }))
  const engine = ctx.workflowEngine as StubEngine
  if (options.factory !== undefined) engine.factory = options.factory
  if (options.flush !== false) ctx.on('session/flush', () => {})
  for (const name of options.skills ?? roleSkills) {
    ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
  }
  await ctx.plugin(toolConductor, options.config ?? { subagentProvider: 'fresh' })
  const session = ctx.sessions.create(SessionId(`conductor-tool-${Math.random()}`), { meta: { cwd: process.cwd() } })
  session.append('turn/start', { turn: 1 })
  const parent = { ctx, session } as unknown as Agent
  return { ctx, engine, parent }
}

function execute(ctx: Context, args: unknown, agent?: Agent) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`conductor-call-${Math.random()}`),
    name: 'conductor',
    arguments: args,
    ...(agent === undefined ? {} : { agent }),
  })
}

const baseArgs = {
  objective: 'Repair Conductor CI.',
  scope: ['packages/conductor'],
  inputArtifacts: ['coverage.txt'],
  allowedPaths: ['packages/conductor'],
  excludedPaths: [],
  sourceBaseline: 'HEAD',
  constraints: ['no release'],
  acceptanceCriteria: ['focused checks pass'],
  authority: { owner: 'user' },
}

describe('dsh-tool-conductor unit boundary', () => {
  it('validates direct config and every fresh-provider capability before registration', async () => {
    expect(() => { toolConductor.apply(new Context(), { subagentProvider: ' ' }) }).toThrow(/normalized/)
    expect(() => { toolConductor.apply(new Context(), { maxReworkCycles: 0 }) }).toThrow(/maxReworkCycles/)
    expect(() => { toolConductor.apply(new Context(), { maxRalphRounds: -1 }) }).toThrow(/maxRalphRounds/)
    expect(() => { toolConductor.apply(new Context(), { maxRalphHandoffChars: 0 }) }).toThrow(/maxRalphHandoffChars/)

    const missing = new Context()
    await missing.plugin(SubagentRuntime)
    expect(() => { toolConductor.apply(missing, { subagentProvider: 'missing' }) }).toThrow(/not registered/)

    const cases: Array<[Partial<SubagentCapabilities>, boolean, RegExp]> = [
      [{ outputSchema: false }, false, /structured output/],
      [{ toolFilter: false }, false, /tool restrictions/],
      [{ toolGuard: false }, false, /argument-aware tool guards/],
      [{ persona: false }, false, /child personas/],
      [{ toolContribution: false }, false, /child tool contributions/],
      [{}, true, /inherits parent context/],
    ]
    for (const [capabilities, inheritsParentContext, message] of cases) {
      const ctx = await services(new StubProvider({ capabilities, inheritsParentContext }))
      expect(() => { toolConductor.apply(ctx, { subagentProvider: 'fresh' }) }).toThrow(message)
    }
  })

  it('drives a complete run, exposes replay-safe presentation, and requires host-only closeout', async () => {
    const { ctx, engine, parent } = await setup({ config: {} })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    if (result.isError) throw new Error('expected Conductor success')
    expect(result.value).toMatchObject({ stage: 'closeout', status: 'awaiting_authorization' })
    expect(engine.requests).toHaveLength(7)
    expect(engine.disposed).toBe(7)

    const tool = ctx.tools.get('conductor')
    if (tool?.presentCall === undefined || tool.presentResult === undefined || tool.output?.render === undefined) {
      throw new Error('Conductor tool presentation must be registered')
    }
    expect(tool.presentCall({ objective: 'Repair it.' })).toEqual({
      card: 'generic', title: 'conductor', rawInput: 'Repair it.',
    })
    expect(tool.presentResult({ objective: 'Repair it.' }, { content: [], isError: false })).toEqual({ card: 'generic' })
    expect(tool.output.render({}, { result: { kind: 'blocked', blocker: 'owner input' } })[0]).toMatchObject({
      type: 'text', text: 'Conductor run blocked: owner input',
    })
    expect(tool.output.render({}, { result: null })[0]).toMatchObject({
      type: 'text', text: 'Conductor run returned an unknown outcome',
    })

    const runId = (result.value as { runId: string }).runId
    const waiting = await execute(ctx, { ...baseArgs, runId }, parent)
    expect(waiting.value).toMatchObject({ result: { kind: 'blocked' } })
    const closed = await execute(ctx, {
      ...baseArgs,
      runId,
      closeoutAuthorization: {
        authorizedBy: 'user', action: 'record-only', actionsTaken: ['recorded'], outcomeEvidence: ['Gate G'],
        unverifiedItems: [], openRisks: [], followUp: [],
        traceability: { mandate: ['request'], baseline: ['HEAD'], changes: [], verification: ['audit'], decision: ['G'] },
      },
    }, parent)
    expect(closed.isError).toBe(true)
    expect((closed.content[0] as { text: string }).text).toMatch(/closeout authorization is host-only/)
    expect(tool.output.render({}, { result: { kind: 'closeout' } })[0]).toMatchObject({
      type: 'text', text: expect.stringContaining('Conductor run closed.'),
    })
  })

  it('includes a bounded Ralph result under the approved baseline authorization', async () => {
    const { ctx, engine, parent } = await setup({ config: {
      subagentProvider: 'fresh', maxRalphRounds: 1, maxRalphHandoffChars: 1_000,
    } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(engine.requests).toHaveLength(8)
    const headsman = engine.requests.find(request => (request.args as { label?: string }).label === 'conductor-headsman')
    const headsmanPrompt = (headsman?.args as { prompt: string }).prompt
    expect(headsmanPrompt).toContain('Headsman-internal Ralph result')
    expect(headsmanPrompt).toContain('Ralph complete')
    expect(headsmanPrompt).toContain('focused test')
  })

  it('validates caller authority and normalized path and string lists before dispatch', async () => {
    const { ctx, engine, parent } = await setup()
    const { authority: _authority, ...withoutAuthority } = baseArgs
    const cases: Array<[unknown, RegExp]> = [
      [baseArgs, /calling agent/],
      [{ ...baseArgs, objective: ' ' }, /objective/],
      [withoutAuthority, /authority/],
      [{ ...baseArgs, authority: { owner: ' ' } }, /authority/],
      [{ ...baseArgs, authority: { owner: 'user', permittedActions: ['delete'] } }, /permittedActions/],
      [{ ...baseArgs, allowedPaths: [' '] }, /allowedPaths/],
      [{ ...baseArgs, allowedPaths: ['x', 'x'] }, /allowedPaths.*duplicates/],
      [{ ...baseArgs, excludedPaths: [' '] }, /excludedPaths/],
      [{ ...baseArgs, excludedPaths: ['x', 'x'] }, /excludedPaths.*duplicates/],
      [{ ...baseArgs, scope: [' '] }, /scope/],
      [{ ...baseArgs, scope: ['x', 'x'] }, /scope.*duplicates/],
      [{ ...baseArgs, inputArtifacts: [' '] }, /inputArtifacts/],
      [{ ...baseArgs, constraints: ['x', 'x'] }, /constraints.*duplicates/],
      [{ ...baseArgs, acceptanceCriteria: [' '] }, /acceptanceCriteria/],
      [{
        ...baseArgs,
        closeoutAuthorization: {
          authorizedBy: 'user', action: 'record-only', actionsTaken: [], outcomeEvidence: ['Gate G'],
          unverifiedItems: [], openRisks: [], followUp: [],
          traceability: { mandate: [], baseline: [], changes: [], verification: [], decision: [] },
        },
      }, /closeout authorization is host-only/],
    ]
    for (const [args, message] of cases) {
      const result = await execute(ctx, args, message.source.includes('calling agent') ? undefined : parent)
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toMatch(message)
    }
    expect(engine.requests).toHaveLength(0)
  })

  it('defaults omitted lists and rejects a missing durability listener', async () => {
    const { ctx, parent } = await setup({ flush: false })
    const result = await execute(ctx, {
      objective: 'Use defaults.',
      authority: { owner: 'user' },
    }, parent)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/could not durably flush/)
  })

  it('rejects invalid, missing, or mismatched resume inputs before redispatch', async () => {
    const { ctx, parent } = await setup()
    const created = await execute(ctx, baseArgs, parent)
    if (created.isError) throw new Error('expected initial run')
    const runId = (created.value as { runId: string }).runId
    const cases: Array<[unknown, RegExp]> = [
      [{ ...baseArgs, runId: 'bad' }, /not a valid/],
      [{ ...baseArgs, runId: 'CON-9999-9999' }, /not found/],
      [{ ...baseArgs, runId, objective: 'Different.' }, /objective does not match/],
      [{ ...baseArgs, runId, authority: { owner: 'other' } }, /authority does not match/],
      [{ ...baseArgs, runId, allowedPaths: [] }, /allowedPaths do not match/],
      [{ ...baseArgs, runId, excludedPaths: ['private'] }, /excludedPaths do not match/],
    ]
    for (const [args, message] of cases) {
      const result = await execute(ctx, args, parent)
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toMatch(message)
    }
  })

  it('turns absent skills and non-completed or empty child results into bounded failures', async () => {
    const missingSkill = await setup({ skills: roleSkills.filter(name => name !== 'conductor-detective') })
    const absent = await execute(missingSkill.ctx, baseArgs, missingSkill.parent)
    expect(absent.isError).toBe(true)
    expect((absent.content[0] as { text: string }).text).toMatch(/required skill.*unavailable/)

    for (const value of [null, undefined]) {
      const empty = await setup({
        factory: () => ({ stopReason: 'completed', agentsStarted: 1, value }),
      })
      const result = await execute(empty.ctx, baseArgs, empty.parent)
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
    }

    const unestablished = await setup({
      factory: () => ({ stopReason: 'completed', agentsStarted: 1, value: null }),
    })
    const unestablishedResult = await execute(unestablished.ctx, {
      objective: 'Establish the baseline.', authority: { owner: 'user' },
    }, unestablished.parent)
    expect(unestablishedResult.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })

    const arbiterEmpty = await setup({
      factory: (request) => {
        const args = request.args as { label?: string }
        return args.label === 'conductor-arbiter'
          ? { stopReason: 'completed', agentsStarted: 1, value: null }
          : successfulResult(request)
      },
    })
    const arbiterResult = await execute(arbiterEmpty.ctx, baseArgs, arbiterEmpty.parent)
    expect(arbiterResult.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })

    const failed = await setup({
      factory: () => ({ stopReason: 'error', error: 'child failed', agentsStarted: 1, value: null }),
    })
    const result = await execute(failed.ctx, baseArgs, failed.parent)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
  })

  it('retries a colliding minted id and rejects early closeout authorization', async () => {
    const collision = await setup()
    const load = vi.spyOn(SessionConductorRunStore.prototype, 'load')
      .mockResolvedValueOnce(createRun(ConductorRunId('CON-2026-9999'), {
        objective: 'occupied', authority: { owner: 'user' },
      }))
    const created = await execute(collision.ctx, baseArgs, collision.parent)
    expect(created.isError, JSON.stringify(created)).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
    load.mockRestore()

    const running = await setup()
    const runId = ConductorRunId('CON-2026-0042')
    const run = createRun(runId, {
      objective: 'Reject premature closeout.',
      authority: { owner: 'user' },
    })
    await new SessionConductorRunStore(running.parent.session, () => Promise.resolve()).save(run)
    const premature = await execute(running.ctx, {
      objective: run.objective,
      runId,
      authority: run.authority,
      closeoutAuthorization: {
        authorizedBy: 'user', action: 'record-only', actionsTaken: [], outcomeEvidence: ['not ready'],
        unverifiedItems: [], openRisks: [], followUp: [],
        traceability: { mandate: [], baseline: [], changes: [], verification: [], decision: [] },
      },
    }, running.parent)
    expect(premature.isError).toBe(true)
    expect((premature.content[0] as { text: string }).text).toMatch(/closeout authorization is host-only/)
  })
})
