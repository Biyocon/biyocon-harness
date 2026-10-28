import { toolAdmission } from './intake-fixtures.ts'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  ConductorRunId, createRun, executionBaselineHash, executionEffectProfile,
  QualityCommandId, recordGate, SessionConductorRunStore,
} from '@deepseek-ai/dsh-conductor'
import type { ConductorAdmission, ConductorRun, CapturedReport, QualityCommandBinding } from '@deepseek-ai/dsh-conductor'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
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
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowResult, WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { describe, expect, it, vi } from 'vitest'
import * as toolConductor from '../src/index.ts'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { mountQualityServices } from './quality-services.ts'
import { resolveQualityCatalog } from '../src/quality-catalog.ts'

const signal = new AbortController().signal

it('removes the standalone child projection when the tool fiber is disposed', async () => {
  const ctx = await services()
  await ctx.plugin(SessionProjections)
  const fiber = await ctx.plugin(toolConductor, { subagentProvider: 'fresh' })
  const session = ctx.sessions.create(SessionId('projection-disposal'))
  expect(ctx.sessionProjections.snapshot(session).values.conductorChildren).toEqual({})
  await fiber.dispose()
  expect(ctx.sessionProjections.snapshot(session).values.conductorChildren).toBeUndefined()
})
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
        rollbackReference: 'HEAD',
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
  publishChildren = true

  start(request: WorkflowStartRequest): WorkflowRun {
    this.requests.push(request)
    const id = WorkflowRunId(`conductor-test-${this.requests.length}`)
    const result = this.factory(request)
    return {
      id,
      meta: request.meta,
      result: Promise.resolve().then(() => {
        if (this.publishChildren && result.agentsStarted > 0) {
          const info = { id, meta: request.meta }
          const child = { seq: 1, label: (request.args as { label: string }).label, childId: SessionId(`child-${id}`) }
          this.ctx.emit('workflow/agent-start', info, child)
          this.ctx.emit('workflow/agent-end', info, {
            ...child, outcome: result.stopReason === 'completed' ? 'completed' : 'failed',
          })
        }
        return result
      }),
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
  return ctx
}

async function setup(options: {
  config?: toolConductor.Config
  factory?: ResultFactory
  flush?: boolean
  skills?: readonly string[]
  approval?: boolean
  workspace?: boolean
} = {}) {
  const providerName = options.config?.subagentProvider ?? (options.config === undefined ? 'fresh' : 'spawn')
  const ctx = await services(new StubProvider({ name: providerName }))
  const engine = ctx.workflowEngine as StubEngine
  if (options.approval !== false) {
    await ctx.plugin(UserApproval, { policy: 'ask' })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  }
  if (options.factory !== undefined) engine.factory = options.factory
  if (options.flush !== false) ctx.on('session/flush', () => {})
  for (const name of options.skills ?? roleSkills) {
    ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
  }
  await ctx.plugin(toolConductor, options.config ?? { subagentProvider: 'fresh' })
  const session = ctx.sessions.create(SessionId(`conductor-tool-${Math.random()}`), {
    ...options.workspace === false ? {} : { meta: { cwd: process.cwd() } },
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: baseArgs.objective }], source: { kind: 'user' } }), { surfaceOp: 'append' })
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

const intakeArgs = { purpose: 'implementation', entry: 'detective', rationale: 'Explicit implementation mandate.' }
const baseArgs = {
  ...intakeArgs,
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

const { rationale: _intakeRationale, ...resumeArgs } = baseArgs

function analysisResult(request: WorkflowStartRequest): WorkflowResult {
  const prompt = (request.args as { prompt: string }).prompt
  const arbiter = prompt.includes('Analysis record:\n')
  const dispatch = JSON.parse(prompt.split(arbiter ? 'Analysis record:\n' : 'Dispatch package:\n')[1]!.split('\n\nReturn the structured result')[0]!) as {
    run_id: string
    stage: string
    admission: ConductorAdmission
    current_report: CapturedReport
    report: CapturedReport
    audit_hash: string
    acceptance_criteria: string[]
  }
  if (dispatch.admission.purpose !== 'analysis') throw new Error('Expected analysis dispatch')
  const ids = dispatch.admission.materials.map(material => material.id)
  return { stopReason: 'completed', agentsStarted: 1, value: arbiter ? {
    run_id: dispatch.run_id, purpose: 'analysis', candidate_hash: dispatch.report.hash, audit_hash: dispatch.audit_hash,
    decision: 'accept', basis: ['An independent audit assessed this report.'], evidence_reviewed: [dispatch.report.hash], open_risks: [],
  } : {
    run_id: dispatch.run_id, purpose: 'analysis', stage: dispatch.stage, deliverable: dispatch.admission.deliverable,
    status: 'ready', summary: `${dispatch.stage} reviewed the material.`, material_ids: ids, blockers: [], assumptions: [], limitations: [],
    ...dispatch.stage === 'auditor' ? { candidate_hash: dispatch.current_report.hash } : { candidate: {
      version: 'v1', deliverable: dispatch.admission.deliverable, content: 'A documentation gap was found. No tests were executed.',
      criteria: dispatch.acceptance_criteria.map(criterion => ({ criterion, outcome: 'Assessed from the captured input.' })),
      material_ids: ids, assumptions: [], limitations: ['Static review only.'],
    } },
  } }
}

describe('Conductor analysis tool admission and execution policy', () => {
  it.each([{ acceptanceCriteria: undefined }, { acceptanceCriteria: [] }])('rejects missing analysis criteria before saving or dispatching: $acceptanceCriteria', async ({ acceptanceCriteria }) => {
    const h = await setup()
    const { acceptanceCriteria: _criteria, ...args } = baseArgs
    const result = await execute(h.ctx, {
      ...args, purpose: 'analysis', deliverable: 'answer',
      ...acceptanceCriteria === undefined ? {} : { acceptanceCriteria },
      constraints: ['Describe the structure.', 'Justify three recommendations.'],
    }, h.parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result)).toContain('No Conductor run was started: Conductor analysis requires at least one acceptanceCriteria')
    expect(JSON.stringify(result)).toContain('not constraints')
    expect(h.engine.requests).toEqual([])
    expect(h.parent.session.events.filter(event => event.type === 'conductor/checkpoint')).toEqual([])
  })

  it('runs fresh report sessions with no execution tools, contribution, Ralph or approval', async () => {
    const h = await setup({ factory: analysisResult })
    h.ctx.on('approval/request', () => { throw new Error('Analysis must never request approval') })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'reported', stage: 'report-complete', result: { kind: 'report' } })
    expect(h.engine.requests).toHaveLength(3)
    for (const request of h.engine.requests) {
      const prompt = (request.args as { prompt: string }).prompt
      if (prompt.includes('Dispatch package:')) {
        expect(prompt).toContain('copy every acceptance_criteria string verbatim and in the same order')
        expect(prompt).toContain('"gate_history"')
      }
      expect(request.childToolFilter).toEqual({ allow: ['read', 'read_image', 'grep', 'glob'] })
      expect(request.childToolContribution).toBeUndefined()
      const attempt = (name: string) => request.childToolGuard!({ name } as never)
      expect(attempt('read')).toBeUndefined()
      expect(attempt('structured_output')).toBeUndefined()
      for (const tool of ['write', 'bash', 'conductor_quality_check', 'approval', 'conductor']) expect(attempt(tool)).toMatch(/read-only/)
    }
    const tool = h.ctx.tools.get('conductor')!
    const value = result.value
    if (value === undefined) throw new Error('Expected a structured report result')
    const rendered = tool.output.render({}, value)[0]
    expect(rendered?.type).toBe('text')
    expect(rendered?.type === 'text' ? rendered.text : '').toContain('report')
    const runId = (result.value as { runId: string }).runId
    const repeated = await execute(h.ctx, { ...resumeArgs, purpose: 'analysis', deliverable: 'answer', runId }, h.parent)
    expect(JSON.stringify(repeated)).toContain('terminal')
  })

  it('rejects a changed admission on resume and reuses captured material without rereading it', async () => {
    const h = await setup({ factory: () => { throw new Error('interrupted before the child') } })
    const args = { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }
    await execute(h.ctx, args, h.parent)
    const checkpoint = h.parent.session.events.findLast(event => event.type === 'conductor/checkpoint')!
    const run = JSON.parse(checkpoint.data.record!) as ConductorRun
    const again = { ...resumeArgs, purpose: 'analysis', deliverable: 'answer', runId: run.runId }
    for (const changed of [{ ...again, entry: 'strategist' }, { ...again, purpose: 'implementation' },
      { ...again, rationale: 'Reclassify' }, { ...again, materialFiles: [] }, { ...again, scopeSources: [] },
      { ...again, plan: [] }, { ...again, planSources: [] }, { ...again, deliverable: 'recommendations' }]) {
      expect(JSON.stringify(await execute(h.ctx, changed, h.parent))).toMatch(/immutable admission|reuses captured admission/)
    }
    h.engine.factory = analysisResult
    const resumed = await execute(h.ctx, again, h.parent)
    expect(resumed.isError, JSON.stringify(resumed)).toBe(false)
    expect(resumed.value).toMatchObject({ status: 'reported' })
  })

  it('enforces positive material limits and the serialized admission limit', async () => {
    for (const name of ['maxMaterialFiles', 'maxMaterialBytes', 'maxMaterialTotalBytes']) {
      await expect(setup({ config: { subagentProvider: 'fresh', [name]: 0 } })).rejects.toThrow(/expected number >= 1/)
      const ctx = await services()
      expect(() =>{  toolConductor.apply(ctx, { subagentProvider: 'fresh', [name]: 0 }) }).toThrow(/positive safe integer/)
    }
    const h = await setup({ config: { subagentProvider: 'fresh', maxMaterialTotalBytes: 550 } })
    const result = await execute(h.ctx, { ...baseArgs, rationale: 'large rationale '.repeat(60).trim() }, h.parent)
    expect(JSON.stringify(result)).toContain('admission exceeds')
    expect(h.engine.requests).toEqual([])
  })

  it('admits supplied scope and plan selectors on new runs', async () => {
    const h = await setup({ factory: analysisResult })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', entry: 'devils-advocate', deliverable: 'answer',
      scopeSources: ['current-request'], plan: ['Review the supplied task.'], planSources: ['current-request'],
    }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(h.engine.requests).toHaveLength(3)
  })
})

describe('dsh-tool-conductor unit boundary', () => {
  it('rejects specialist-written paths, retries Gate C, and binds only owner paths to the approved baseline', async () => {
    let attempts = 0
    const { ctx, parent, engine } = await setup({ factory(request) {
      const result = successfulResult(request)
      if ((request.args as { label?: string }).label === 'conductor-devils-advocate' && attempts++ === 0) {
        const envelope = result.value as Record<string, unknown>
        return { ...result, value: { ...envelope, execution_baseline: {
          ...(envelope.execution_baseline as object), allowedPaths: ['.'], excludedPaths: [],
        } } }
      }
      return result
    } })
    const excludedPaths = ['packages/conductor/private']
    const result = await execute(ctx, { ...baseArgs, excludedPaths }, parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'awaiting_authorization', result: { run: {
      specialistsRan: ['detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'integrator', 'arbiter'],
      gateHistory: expect.arrayContaining([expect.objectContaining({ kind: 'evaluated', gate: 'C', decision: 'rework', defectClass: 'report' })]) as unknown,
    } } })
    expect(engine.requests.filter(request => (request.args as { label?: string }).label === 'conductor-devils-advocate')).toHaveLength(2)
    const checkpoint = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)!
    const run = JSON.parse(checkpoint.data.record!) as ConductorRun
    expect(run.baseline?.allowedPaths).toEqual(baseArgs.allowedPaths)
    expect(run.baseline?.excludedPaths).toEqual(excludedPaths)
    expect(parent.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
    const schema = engine.requests.find(request => (request.args as { label?: string }).label === 'conductor-devils-advocate')!.args as { schema: { properties: { execution_baseline: { properties: object } } } }
    expect(schema.schema.properties.execution_baseline.properties).not.toHaveProperty('allowedPaths')
    expect(schema.schema.properties.execution_baseline.properties).not.toHaveProperty('excludedPaths')
  })

  it('reports all reached gates and dispatched roles at blocking, and identifies rejection before run creation', async () => {
    const { ctx, parent, engine } = await setup({ factory(request) {
      const result = successfulResult(request)
      if ((request.args as { label?: string }).label === 'conductor-devils-advocate') return { ...result, value: null }
      return result
    } })
    const rejected = await execute(ctx, { ...baseArgs, objective: ' ' }, parent)
    expect(rejected.isError).toBe(true)
    expect(JSON.stringify(rejected.content)).toContain('No Conductor run was started')
    expect(engine.requests).toHaveLength(0)
    const result = await execute(ctx, baseArgs, parent)
    expect(result.value).toMatchObject({ status: 'escalated', result: { run: {
      stage: 'devils-advocate', specialistsRan: ['detective', 'strategist', 'devils-advocate'],
      gateHistory: expect.arrayContaining([
        expect.objectContaining({ kind: 'evaluated', gate: 'A', decision: 'pass' }),
        expect.objectContaining({ kind: 'evaluated', gate: 'C', decision: 'rework' }),
        expect.objectContaining({ kind: 'evaluated', gate: 'C', decision: 'escalate', basis: expect.arrayContaining(['Gate C exhausted its 2 reworks per gate']) as unknown }),
      ]) as unknown,
    } } })
    expect(JSON.stringify(result.content)).toContain('specialistsRan')
    expect(JSON.stringify(result.content)).toContain('gateHistory')
  })

  it('enables parent routing only for an opted-in composition', async () => {
    const { ctx, parent } = await setup({ config: { subagentProvider: 'fresh', routeTasks: true } })
    expect((await execute(ctx, baseArgs, parent)).isError).toBe(false)
  })

  it('validates model authority fields even when a host invokes the tool callback directly', async () => {
    const { ctx, parent } = await setup()
    const tool = ctx.tools.get('conductor')!
    for (const authority of [
      { owner: 'user', permittedActions: ['write'] },
      { owner: 'user', executionPermissions: ['write'] },
    ]) {
      await expect(tool.execute({ ...baseArgs, authority }, {
        agent: parent, signal, callId: CallId('untrusted-authority'),
      } as ToolRunContext)).rejects.toThrow(/not a declared property/)
    }
  })

  it('surfaces workflow infrastructure failures before any quality record exists', async () => {
    const { ctx, parent } = await setup({ factory() { throw new Error('workflow transport unavailable') } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toMatch(/workflow transport unavailable/)
  })

  it('records missing approval services or workspace identity as a controlled Gate C blocker', async () => {
    for (const options of [{ approval: false }, { workspace: false }]) {
      const { ctx, parent, engine } = await setup(options)
      const result = await execute(ctx, baseArgs, parent)
      expect(result.isError).toBe(false)
      expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
      expect(engine.requests).toHaveLength(3)
      expect(parent.session.events.findLast(event => event.type === 'conductor/checkpoint')).toMatchObject({ type: 'conductor/checkpoint' })
    }
  })

  it('rejects malformed Gate C selections without persisting the invalid model report', async () => {
    for (const selection of [undefined, null, [1], [''], [' unit-check '], ['unit-check', 'unit-check']]) {
      const { ctx, parent } = await setup({ factory(request) {
        const result = successfulResult(request)
        if ((request.args as { label?: string }).label !== 'conductor-devils-advocate') return result
        const envelope = result.value as Record<string, unknown>
        return { ...result, value: { ...envelope, execution_baseline: {
          ...(envelope.execution_baseline as object), qualityCommandIds: selection,
        } } }
      } })
      const result = await execute(ctx, baseArgs, parent)
      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
      const event = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)
      if (event?.type !== 'conductor/checkpoint' || event.data.record === null) throw new Error('missing checkpoint')
      const run = await new SessionConductorRunStore(parent.session, () => Promise.resolve()).load(event.data.runId)
      expect(run?.specialistReports.map(report => report.stage)).toEqual(['detective', 'strategist'])
    }
  })

  it('immediately escalates specialist-authored host command bindings instead of retrying authority changes', async () => {
    const { ctx, parent, engine } = await setup({ factory(request) {
      const result = successfulResult(request)
      if ((request.args as { label?: string }).label !== 'conductor-devils-advocate') return result
      const envelope = result.value as Record<string, unknown>
      return { ...result, value: { ...envelope, execution_baseline: {
        ...(envelope.execution_baseline as object), qualityCommands: [],
      } } }
    } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked', run: {
      gateHistory: [
        expect.objectContaining({ kind: 'evaluated', gate: 'A', decision: 'pass' }),
        expect.objectContaining({ kind: 'evaluated', gate: 'B', decision: 'pass' }),
        expect.objectContaining({ kind: 'evaluated', gate: 'C', decision: 'escalate' }),
      ] as unknown,
    } } })
    expect(engine.requests).toHaveLength(3)
    expect(parent.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(0)
  })

  it('reports a non-Error dispatch failure with the durable run identity', async () => {
    const { ctx, parent } = await setup({ factory() { throw 'literal workflow fault' } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('literal workflow fault')
    expect(JSON.stringify(result.content)).toContain('Run status:')
    expect(JSON.stringify(result.content)).toContain('gateHistory')
  })

  it('includes a started Arbiter when infrastructure fails before any Gate G verdict', async () => {
    const { ctx, parent } = await setup({ factory(request) {
      return (request.args as { label?: string }).label === 'conductor-arbiter'
        ? { stopReason: 'error', error: 'Arbiter unavailable', agentsStarted: 1, value: null }
        : successfulResult(request)
    } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError).toBe(true)
    const rendered = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
    const summary = JSON.parse(rendered.split('Run status:\n')[1]!) as {
      stage: string
      gateHistory: { gate: string }[]
      specialistsRan: string[]
    }
    expect(summary.stage).toBe('arbiter')
    expect(summary.specialistsRan).toEqual(['detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'integrator', 'arbiter'])
    expect(summary.gateHistory.map(record => record.gate)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })

  it('does not count an accepted agent call as a specialist that actually started', async () => {
    const { ctx, parent, engine } = await setup({
      factory: () => ({ stopReason: 'error', error: 'Provider failed before publishing a child', agentsStarted: 1, value: null }),
    })
    engine.publishChildren = false
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError).toBe(true)
    const rendered = result.content.filter(item => item.type === 'text').map(item => item.text).join('\n')
    const summary = JSON.parse(rendered.split('Run status:\n')[1]!) as { specialistsRan: string[] }
    expect(summary.specialistsRan).toEqual([])
  })

  it('ignores failed child notifications from unrelated workflows', async () => {
    const { ctx, parent, engine } = await setup()
    const start = engine.start.bind(engine)
    vi.spyOn(engine, 'start').mockImplementation((request) => {
      const workflow = start(request)
      queueMicrotask(() => {
        const info = { id: WorkflowRunId(`unrelated-${workflow.id}`), meta: request.meta }
        const child = { seq: 1, childId: SessionId(`unrelated-child-${workflow.id}`), label: 'unrelated' }
        ctx.emit('workflow/agent-start', info, child)
        ctx.emit('workflow/agent-end', info, { ...child, outcome: 'failed' })
      })
      return workflow
    })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'awaiting_authorization', result: { kind: 'decision' } })
  })

  it('normalizes host approval exclusions and rejects catalog drift before a resumed dispatch', async () => {
    const command = {
      id: 'unit-check', modelSafeDescription: 'Run unit checks.', argv: ['node', '--version'], cwd: '.',
      allowedStages: ['headsman', 'auditor'] as Array<'headsman' | 'auditor'>,
      sandboxMode: 'read-only' as const, timeoutMs: 1000, maxOutputBytes: 4096, graceMs: 100,
    }
    const definition = resolveQualityCatalog([command]).get(command.id)!
    for (const patch of [
      { id: QualityCommandId('removed') },
      { definitionHash: 'f'.repeat(64) },
      { requiredGates: ['D'] },
      { requiredGates: ['E', 'D'] },
    ]) {
      const { ctx, parent, engine } = await setup({ config: { subagentProvider: 'fresh', qualityCommands: [command] } })
      let run = createRun(ConductorRunId('CON-2026-0042'), { ...baseArgs, admission: toolAdmission() })
      const pass = { decision: 'pass' as const, basis: ['verified'], evidenceReviewed: ['review'], stateUpdate: 'advance' }
      run = recordGate(recordGate(run, pass), pass)
      const baseline = {
        scopeVersion: 'scope', planVersion: 'plan', acceptanceVersion: 'acceptance',
        allowedPaths: baseArgs.allowedPaths, excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommands: [{ id: definition.id, definitionHash: definition.definitionHash, requiredGates: ['D', 'E'], ...patch } as QualityCommandBinding],
      }
      const hash = executionBaselineHash(baseline)
      run = recordGate({ ...run, baseline, baselineHistory: [baseline], executionAuthorization: {
        executionBaselineHash: hash, effectProfile: executionEffectProfile(baseline),
      } }, { ...pass, executionBaselineHash: hash })
      await new SessionConductorRunStore(parent.session, () => Promise.resolve()).save(run)
      const result = await execute(ctx, { ...resumeArgs, runId: run.runId }, parent)
      expect(result.isError).toBe(true)
      expect((result.content[0] as { text: string }).text).toMatch(/no longer configured|resume is refused/)
      expect(engine.requests).toHaveLength(0)
    }

    const excludedPaths = ['packages/conductor/private']
    const { ctx, parent } = await setup()
    const result = await execute(ctx, { ...baseArgs, excludedPaths }, parent)
    expect(result.value).toMatchObject({ status: 'awaiting_authorization' })
    const approval = parent.session.events.find(event => event.type === 'approval/asked')
    expect(JSON.stringify(approval)).toContain('excluded_paths')
    expect(JSON.stringify(approval)).toContain('private')
  })

  it('validates direct config and every fresh-provider capability before registration', async () => {
    expect(() => { toolConductor.apply(new Context(), { maxReworkCycles: 2 } as unknown as toolConductor.Config) })
      .toThrow(/maxReworkCycles is unsupported/)
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      expect(() => { toolConductor.apply(new Context(), { maxReworkPerGate: value }) }).toThrow(/positive safe integer/)
    }
    expect(() => { toolConductor.apply(new Context(), { subagentProvider: ' ' }) }).toThrow(/normalized/)
    expect(() => { toolConductor.apply(new Context(), { maxReworkPerGate: 0 }) }).toThrow(/maxReworkPerGate/)
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
    expect(tool.presentCall({ ...intakeArgs, objective: 'Repair it.' })).toEqual({
      card: 'generic', title: 'conductor', rawInput: 'Repair it.',
    })
    expect(tool.presentResult({ ...intakeArgs, objective: 'Repair it.' }, { content: [], isError: false })).toEqual({ card: 'generic' })
    expect(tool.output.render({}, { result: { kind: 'blocked', blocker: 'owner input' } })[0]).toMatchObject({
      type: 'text', text: 'Conductor run blocked: owner input',
    })
    expect(tool.output.render({}, { result: null })[0]).toMatchObject({
      type: 'text', text: 'Conductor run returned an unknown outcome',
    })

    const runId = (result.value as { runId: string }).runId
    const waiting = await execute(ctx, { ...resumeArgs, runId }, parent)
    expect(waiting.value).toMatchObject({ result: { kind: 'blocked' } })
    const closed = await execute(ctx, {
      ...resumeArgs, runId,
      closeoutAuthorization: {
        authorizedBy: 'user', action: 'record-only', actionsTaken: ['recorded'], outcomeEvidence: ['Gate G'],
        unverifiedItems: [], openRisks: [], followUp: [],
        traceability: { mandate: ['request'], baseline: ['HEAD'], changes: [], verification: ['audit'], decision: ['G'] },
      },
    }, parent)
    expect(closed.isError).toBe(true)
    expect((closed.content[0] as { text: string }).text).toMatch(/closeout authorization is host-only/)
    const rendered = tool.output.render({}, { result: { kind: 'closeout' } })[0]
    if (rendered?.type !== 'text') throw new Error('expected closeout text')
    expect(rendered.text).toContain('Conductor run closed.')
  })

  it('includes a bounded Ralph result under the approved baseline authorization', async () => {
    const { ctx, engine, parent } = await setup({ config: {
      subagentProvider: 'fresh', maxRalphRounds: 1, maxRalphHandoffChars: 1_000,
    } })
    const result = await execute(ctx, baseArgs, parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(engine.requests).toHaveLength(8)
    const ralph = engine.requests.find(request => (request.args as { label?: string }).label === undefined)
    expect((ralph?.args as { objective: string }).objective).toContain('"execution_baseline"')
    expect((ralph?.args as { objective: string }).objective).toContain('"rollbackReference": "HEAD"')
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
      ...intakeArgs, objective: 'Use defaults.',
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
      [{ ...resumeArgs, runId: 'bad' }, /not a valid/],
      [{ ...resumeArgs, runId: 'CON-9999-9999' }, /not found/],
      [{ ...resumeArgs, runId, objective: 'Different.' }, /objective does not match/],
      [{ ...resumeArgs, runId, authority: { owner: 'other' } }, /authority does not match/],
      [{ ...resumeArgs, runId, allowedPaths: [] }, /allowedPaths do not match/],
      [{ ...resumeArgs, runId, excludedPaths: ['private'] }, /excludedPaths do not match/],
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

    for (const value of [null, undefined, false]) {
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
      ...intakeArgs, objective: 'Establish the baseline.', authority: { owner: 'user' },
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
    const result = await execute(failed.ctx, {
      ...intakeArgs,
      objective: 'Stop a failed child before establishing a baseline.', authority: { owner: 'user' },
    }, failed.parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Conductor detective child failed')
    const checkpoint = failed.parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)!
    const run = JSON.parse(checkpoint.data.record!) as ConductorRun
    expect(run.history).toEqual([])
    expect(run.specialistReports).toEqual([])
  })

  it('retries a colliding minted id and rejects early closeout authorization', async () => {
    const collision = await setup()
    const load = vi.spyOn(SessionConductorRunStore.prototype, 'load')
      .mockResolvedValueOnce(createRun(ConductorRunId('CON-2026-9999'), { admission: toolAdmission(),
        objective: 'occupied', authority: { owner: 'user' },
      }))
    const created = await execute(collision.ctx, baseArgs, collision.parent)
    expect(created.isError, JSON.stringify(created)).toBe(false)
    expect(load).toHaveBeenCalledTimes(2)
    load.mockRestore()

    const running = await setup()
    const runId = ConductorRunId('CON-2026-0042')
    const run = createRun(runId, { admission: toolAdmission(),
      objective: 'Reject premature closeout.',
      authority: { owner: 'user' },
    })
    await new SessionConductorRunStore(running.parent.session, () => Promise.resolve()).save(run)
    const premature = await execute(running.ctx, {
      purpose: 'implementation', entry: 'detective', objective: run.objective,
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
