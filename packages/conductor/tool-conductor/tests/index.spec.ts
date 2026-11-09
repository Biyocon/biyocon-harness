import { toolAdmission } from './intake-fixtures.ts'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import {
  ConductorRunId, ConductorRunUnavailableError, createRun, executionBaselineHash, executionEffectProfile, conductorChildrenProjection,
  QualityCommandId, ownerMandateHash, recordGate, SessionConductorRunStore,
} from '@deepseek-ai/dsh-conductor'
import type { ConductorAdmission, ConductorRun, CapturedReport, QualityCommandBinding } from '@deepseek-ai/dsh-conductor'
import LlmRuntime, { CallId, createUserMessage, LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
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
import type { ToolRunContext, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
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
  criticUsage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens?: number
    cacheWriteTokens?: number
    reasoningTokens?: number
  } | null = { inputTokens: 100, outputTokens: 5 }

  start(request: WorkflowStartRequest): WorkflowRun {
    this.requests.push(request)
    const id = WorkflowRunId(`conductor-test-${this.requests.length}`)
    const childId = SessionId(`child-${id}`)
    const originalPrompt = (request.args as { prompt: string }).prompt
    const composed = request.composeChildPrompt?.(childId, originalPrompt)
    const result = this.factory(composed === undefined ? request : { ...request,
      args: { ...request.args as Record<string, unknown>, prompt: composed.find(block => block.type === 'text')?.text ?? '' } })
    return {
      id,
      meta: request.meta,
      result: Promise.resolve().then(() => {
        if (this.publishChildren && result.agentsStarted > 0) {
          const info = { id, meta: request.meta }
          const child = { seq: 1, label: (request.args as { label: string }).label, childId }
          this.ctx.emit('workflow/agent-start', info, child)
          if (composed !== undefined && this.criticUsage !== null) {
            this.ctx.emit('session/event', { id: childId } as never,
              { type: 'assistant/message', data: { usage: this.criticUsage } } as never)
          }
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
  await ctx.plugin(AgentRegistry)
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
  liveParent?: boolean
} = {}) {
  const providerName = options.config?.subagentProvider ?? (options.config === undefined ? 'fresh' : 'spawn')
  const ctx = await services(new StubProvider({ name: providerName }))
  if (options.liveParent === true) {
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(AgentLoop, { agents: [] })
  }
  const engine = ctx.workflowEngine as StubEngine
  if (options.approval !== false) {
    await ctx.plugin(UserApproval, { policy: 'ask' })
    ctx.on('approval/request', () => Promise.resolve('allowed-once' as const))
  }
  if (options.factory !== undefined) engine.factory = options.factory
  if (options.flush !== false) ctx.on('session/flush', () => {})
  for (const name of options.skills ?? roleSkills) {
    ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test',
      ...['conductor-devils-advocate', 'conductor-specialist'].includes(name)
        ? { metadata: { analysisCritic: { dispatchMode: 'critic', instructions: 'Challenge the evidence and reasoning.' } } } : {} })
  }
  await ctx.plugin(toolConductor, Object.assign({}, options.config ?? { subagentProvider: 'fresh' },
    options.liveParent === true ? { routeTasks: true } : {}))
  const sessionId = SessionId(`conductor-tool-${Math.random()}`)
  if (options.liveParent === true) {
    const { agent: parent } = await ctx.agents.create({ sessionId,
      meta: { cwd: process.cwd() }, agentOptions: { provider: 'owner-unit', model: 'owner-unit' } })
    return { ctx, engine, parent }
  }
  const session = ctx.sessions.create(sessionId, {
    ...options.workspace === false ? {} : { meta: { cwd: process.cwd() } },
  })
  session.append('turn/start', { turn: 1 })
  session.append('user/message', createUserMessage({ content: [{ type: 'text', text: baseArgs.objective }], source: { kind: 'user' } }), { surfaceOp: 'append' })
  const parent = { ctx, session } as unknown as Agent
  return { ctx, engine, parent }
}

async function executeOwnerTask(
  h: Awaited<ReturnType<typeof setup>>,
  args: typeof baseArgs | (typeof baseArgs & { purpose: string; deliverable: string }),
) {
  const done = Promise.withResolvers<undefined>()
  h.ctx.provide('conductorOwnerHostTest', { kind: 'scripted-test-provider', settled: done.promise,
    interact: async (controller, parent, runId, signal) => {
      try {
        const binding = await controller.reconnect(parent, runId)
        const store = new SessionConductorRunStore(parent.session, () => Promise.resolve())
        const run = (await store.load(runId))!
        const entry = run.ownerLedger.at(-1)!
        if (entry.kind !== 'question') throw new Error('Expected owner question')
        const response = await h.ctx.get('conductorOwnerTestProvider')!.answer(run, entry.question)
        if (response === null) throw new Error('Expected scripted unit answer')
        await controller.respond(parent, binding, response, signal)
        await parent.whenIdle()
        done.resolve(undefined)
      } catch (error: unknown) { done.reject(error); throw error }
    },
  })
  const results: ToolExecutionResult[] = []
  h.ctx.on('tools/result', (exec, result) => { if (exec.agent === h.parent && exec.name === 'conductor') results.push(result) })
  h.ctx.llm.registerAdapter(['owner-unit'], new class extends LlmAdapter {
    private calls = 0
    async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
      if (result !== undefined) {
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      const input = options.messages.flatMap(message => message.content).findLast(block => block.type === 'text'
        && block.text.startsWith('Continue only the stored Conductor run.'))
      let callArgs: unknown = args
      if (input?.type === 'text') {
        const stored = JSON.parse(input.text.slice(input.text.indexOf('\n') + 1)) as {
          runId: string
          objective: string
          admission: ConductorAdmission
          authority: { owner: string }
          allowedPaths: string[]
          excludedPaths: string[]
        }
        callArgs = { runId: stored.runId, objective: stored.objective, purpose: stored.admission.purpose, entry: stored.admission.entry,
          ...stored.admission.purpose === 'analysis' ? { deliverable: stored.admission.deliverable } : {},
          authority: stored.authority, allowedPaths: stored.allowedPaths, excludedPaths: stored.excludedPaths }
      }
      const block = { type: 'tool-call' as const, id: CallId(`owner-unit-${++this.calls}`), name: 'conductor', arguments: JSON.stringify(callArgs) }
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
      yield { type: 'block-end', index: 0, block }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
  }())
  h.parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: args.objective }] }))
  await h.parent.whenIdle()
  await done.promise
  await h.parent.whenIdle()
  return results.at(-1)!
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
  if (prompt.startsWith('{"identity":')) {
    const critic = JSON.parse(prompt) as { identity: {
      run_id: string
      candidate_hash: string
      candidate_version: string
      material_ids: string[]
      critic_child_id: string
      critic_attempt: number
    } }
    return { stopReason: 'completed', agentsStarted: 1, value: {
      run_id: critic.identity.run_id, purpose: 'analysis', candidate_hash: critic.identity.candidate_hash,
      candidate_version: critic.identity.candidate_version, material_ids: critic.identity.material_ids,
      critic_child_id: critic.identity.critic_child_id, critic_attempt: critic.identity.critic_attempt,
      findings: [], conclusion: 'holds', summary: 'The report reasoning holds.',
    } }
  }
  const arbiter = prompt.includes('Analysis record:\n')
  const dispatch = JSON.parse(prompt.split(arbiter ? 'Analysis record:\n' : 'Dispatch package:\n')[1]!.split('\n\nReturn the structured result')[0]!) as {
    run_id: string
    stage: string
    admission: ConductorAdmission
    current_report: CapturedReport
    report: CapturedReport
    audit_hash: string
    current_challenge_hash: string
    acceptance_criteria: string[]
  }
  if (dispatch.admission.purpose !== 'analysis') throw new Error('Expected analysis dispatch')
  const ids = dispatch.admission.materials.map(material => material.id)
  return { stopReason: 'completed', agentsStarted: 1, value: arbiter ? {
    run_id: dispatch.run_id, purpose: 'analysis', candidate_hash: dispatch.report.hash,
    challenge_hash: dispatch.current_challenge_hash, audit_hash: dispatch.audit_hash,
    decision: 'accept', basis: ['An independent audit assessed this report.'], evidence_reviewed: [dispatch.report.hash], open_risks: [],
  } : {
    run_id: dispatch.run_id, purpose: 'analysis', stage: dispatch.stage, deliverable: dispatch.admission.deliverable,
    status: 'ready', summary: `${dispatch.stage} reviewed the material.`, material_ids: ids, blockers: [], assumptions: [], limitations: [],
    ...dispatch.stage === 'auditor' ? { candidate_hash: dispatch.current_report.hash } : { candidate: {
      version: 'v1', deliverable: dispatch.admission.deliverable, content: 'A documentation gap was found. No tests were executed.',
      criteria: dispatch.acceptance_criteria.map(criterion => ({ criterion, outcome: 'Assessed from the captured input.' })),
      material_ids: ids, material_spans: ids.map(id => ({ material_id: id, start_line: 1, end_line: 1 })),
      assumptions: [], limitations: ['Static review only.'],
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

  it('flushes validated critic presentation with its checkpoint before another dispatch can start', async () => {
    const h = await setup({ factory: analysisResult, flush: false })
    let durable: typeof h.parent.session.events | undefined
    h.ctx.on('session/flush', (session) => {
      const checkpoint = session.events.findLast(event => event.type === 'conductor/checkpoint')
      if (checkpoint?.type !== 'conductor/checkpoint' || checkpoint.data.record === null) return
      const run = JSON.parse(checkpoint.data.record) as ConductorRun
      if (run.analysisChallenges.length === 0) return
      durable ??= structuredClone(session.events)
      throw new Error('Simulated process loss immediately after checkpoint persistence')
    })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError).toBe(true)
    expect(h.engine.requests).toHaveLength(2)
    expect(durable).toBeDefined()
    let state = conductorChildrenProjection.init()
    for (const event of durable!) state = conductorChildrenProjection.apply(state, event)
    const restored = conductorChildrenProjection.schema.parse(conductorChildrenProjection.view(state))
    expect(Object.values(restored).find(child => child.mode === 'critic')?.gate).toMatchObject({
      id: 'C', decision: 'pass', challengeConclusion: 'holds', challenge: { result: { conclusion: 'holds' } },
    })
    await h.ctx.fiber.dispose()
  })

  it('runs fresh report sessions with no execution tools, contribution, Ralph or approval', async () => {
    const h = await setup({ factory: analysisResult })
    h.ctx.on('approval/request', () => { throw new Error('Analysis must never request approval') })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'reported', stage: 'report-complete', result: { kind: 'report' } })
    expect(h.engine.requests).toHaveLength(4)
    for (const request of h.engine.requests) {
      const prompt = (request.args as { prompt: string }).prompt
      if (prompt.includes('Dispatch package:')) {
        expect(prompt).toContain('copy every acceptance_criteria string verbatim and in the same order')
        expect(prompt).toContain('"gate_history"')
      }
      const critic = request.composeChildPrompt !== undefined
      expect(request.childToolFilter).toEqual({ allow: critic ? [] : ['read', 'read_image', 'grep', 'glob'] })
      expect(request.childToolContribution).toBeUndefined()
      const attempt = (name: string) => request.childToolGuard!({ name } as never)
      expect(attempt('read')).toBe(critic ? 'Conductor critic uses only admitted excerpts.' : undefined)
      expect(attempt('structured_output')).toBeUndefined()
      for (const tool of ['write', 'bash', 'conductor_quality_check', 'approval', 'conductor']) {
        expect(attempt(tool)).toMatch(critic ? /admitted excerpts/ : /read-only/)
      }
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

  it('admits a cited ASCII source whose byte length exceeds the critic token limit', async () => {
    let criticPrompt = ''
    const h = await setup({ factory: (request) => {
      const prompt = (request.args as { prompt: string }).prompt
      if (prompt.startsWith('{"identity":')) criticPrompt = prompt
      return analysisResult(request)
    } })
    const material = 'The source evidence supports the proposed review sequence. '.repeat(600)
    expect(Buffer.byteLength(material, 'utf8')).toBeGreaterThan(24_000)
    h.parent.session.append('user/message', createUserMessage({
      content: [{ type: 'text', text: material }], source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'reported' })
    expect(h.engine.requests.map(request => (request.args as { label: string }).label))
      .toEqual(['conductor-detective', 'conductor-devils-advocate', 'conductor-auditor', 'conductor-arbiter'])
    expect(criticPrompt).toContain(material)
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
    expect(h.engine.requests).toHaveLength(4)
  })

  it('requires a completed producer child before accepting an analysis candidate', async () => {
    const h = await setup({ factory: analysisResult })
    h.engine.publishChildren = false
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Conductor analysis producer has no completed child identity')
    expect(h.engine.requests).toHaveLength(1)
  })

  it('sends the prior accepted challenge to the next critic after a new candidate', async () => {
    let producerVersion = 0
    const h = await setup({ factory: (request) => {
      const result = analysisResult(request)
      const prompt = (request.args as { prompt: string }).prompt
      if (prompt.startsWith('{"identity":')) {
        const challenge = result.value as Record<string, unknown>
        if (challenge.critic_attempt !== 1) return result
        return { ...result, value: { ...challenge, conclusion: 'does_not_hold', defect: 'report',
          findings: [{ id: 'unsupported-priority', severity: 'major', claim: 'The priority does not follow.',
            rationale: 'The cited evidence supports an alternative.', material_ids: challenge.material_ids }],
          summary: 'Reconsider the priority.' } }
      }
      if ((request.args as { label: string }).label !== 'conductor-detective') return result
      const envelope = result.value as Record<string, unknown>
      producerVersion++
      return { ...result, value: { ...envelope,
        candidate: { ...envelope.candidate as object, version: `v${producerVersion}` } } }
    } })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'reported' })
    const event = h.parent.session.events.findLast(item => item.type === 'conductor/checkpoint')
    if (event?.type !== 'conductor/checkpoint' || event.data.record === null) throw new Error('Expected a checkpoint')
    const run = await new SessionConductorRunStore(h.parent.session, () => Promise.resolve()).load(event.data.runId)
    expect(run?.reportCandidates.map(item => item.candidate.version)).toEqual(['v1', 'v2'])
    expect(run?.analysisChallenges.map(item => [item.criticAttempt, item.challenge.conclusion]))
      .toEqual([[1, 'does_not_hold'], [2, 'holds']])
  })

  it('ends Gate C when another complete critic attempt cannot be reserved', async () => {
    const h = await setup({ config: { subagentProvider: 'fresh',
      maxCriticInputTokensPerAttempt: 10_000, maxCriticOutputTokensPerAttempt: 32,
      maxCriticTokensPerRun: 10_032 }, factory: (request) => {
      const result = analysisResult(request)
      if (request.composeChildPrompt === undefined) return result
      return { ...result, value: { ...result.value as Record<string, unknown>,
        findings: [{ id: 'unresolved', severity: 'major', claim: 'Unsupported conclusion',
          rationale: 'The evidence is incomplete.', material_ids: [] }] } }
    } })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
    expect(JSON.stringify(result.value)).toContain('consumed 105, reserved 10032, limit 10032 tokens')
    expect(h.engine.requests).toHaveLength(2)
    const record = h.parent.session.events.findLast(event => event.type === 'conductor/checkpoint')
    if (record?.type !== 'conductor/checkpoint' || record.data.record === null) throw new Error('Expected a checkpoint')
    const run = JSON.parse(record.data.record) as ConductorRun
    expect(run.history.at(-1)).toMatchObject({ gate: 'C', origin: 'critic-budget', decision: 'escalate' })
    expect(run.ownerLedger).toEqual([])
    expect(run.budget).toMatchObject({ maxCriticInputTokensPerAttempt: 10_000,
      maxCriticOutputTokensPerAttempt: 32, maxCriticTokensPerRun: 10_032 })
    expect((result.value as { result: { run: { specialistsRan: string[] } } }).result.run.specialistsRan)
      .toEqual(['detective', 'devils-advocate'])
  })

  it.each([
    { usage: null, reason: 'did not report valid' },
    { usage: { inputTokens: -1, outputTokens: 5 }, reason: 'did not report valid' },
    { usage: { inputTokens: 24_001, outputTokens: 5 }, reason: 'exceeded the configured' },
  ])('stops a critic with untrustworthy provider token usage: $reason', async ({ usage, reason }) => {
    const h = await setup({ factory: analysisResult })
    h.engine.criticUsage = usage
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
    expect(JSON.stringify(result.value)).toContain(reason)
    expect(h.engine.requests).toHaveLength(2)
    const record = h.parent.session.events.findLast(event => event.type === 'conductor/checkpoint')
    if (record?.type !== 'conductor/checkpoint' || record.data.record === null) throw new Error('Expected a checkpoint')
    const run = JSON.parse(record.data.record) as ConductorRun
    expect(run.ownerLedger).toEqual([])
  })

  it('charges cached input once and retains the provider reasoning-inclusive output total', async () => {
    const h = await setup({ factory: analysisResult })
    h.engine.criticUsage = { inputTokens: 100, cacheReadTokens: 20, cacheWriteTokens: 30,
      outputTokens: 17, reasoningTokens: 12 }
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.value).toMatchObject({ status: 'reported' })
    const record = h.parent.session.events.findLast(event => event.type === 'conductor/checkpoint')
    if (record?.type !== 'conductor/checkpoint' || record.data.record === null) throw new Error('Expected a checkpoint')
    const run = JSON.parse(record.data.record) as ConductorRun
    const critic = run.history.find(gate => gate.kind === 'evaluated' && gate.analysis?.mode === 'critic')
    expect(critic?.kind === 'evaluated' && critic.analysis).toMatchObject({ inputTokens: 150, outputTokens: 17 })
  })

  it.each([false, true])('checkpoints a failed started critic with %s token usage before stopping', async (missingUsage) => {
    const h = await setup({ factory: (request) => {
      const result = analysisResult(request)
      return request.composeChildPrompt === undefined ? result
        : { stopReason: 'error', error: 'critic provider stopped', agentsStarted: 1, value: null }
    } })
    if (missingUsage) h.engine.criticUsage = null
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
    const event = h.parent.session.events.findLast(item => item.type === 'conductor/checkpoint')
    if (event?.type !== 'conductor/checkpoint' || event.data.record === null) throw new Error('Expected a checkpoint')
    const run = await new SessionConductorRunStore(h.parent.session, () => Promise.resolve()).load(event.data.runId)
    expect(run?.history.at(-1)).toMatchObject({ kind: 'evaluated', gate: 'C', decision: 'escalate',
      analysis: { mode: 'critic', criticAttempt: 1,
        ...missingUsage ? {} : { inputTokens: 100, outputTokens: 5 } } })
    expect(run?.ownerLedger).toEqual([])
    expect(h.engine.requests).toHaveLength(2)
  })

  it('does not checkpoint a critic child that never started', async () => {
    const h = await setup({ factory: (request) => {
      const result = analysisResult(request)
      return request.composeChildPrompt === undefined ? result
        : { stopReason: 'error', error: 'critic provider never started', agentsStarted: 0, value: null }
    } })
    const result = await execute(h.ctx, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' }, h.parent)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('Conductor devils-advocate workflow stopped: error')
    const event = h.parent.session.events.findLast(item => item.type === 'conductor/checkpoint')
    if (event?.type !== 'conductor/checkpoint' || event.data.record === null) throw new Error('Expected a checkpoint')
    const run = await new SessionConductorRunStore(h.parent.session, () => Promise.resolve()).load(event.data.runId)
    expect(run?.history.filter(item => item.kind === 'evaluated').map(item => item.stage)).toEqual(['detective'])
  })
})

describe('P1 owner configuration and observed child continuation', () => {
  it('validates the per-gate owner limit through both Loader and direct resolution', async () => {
    for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => { toolConductor.apply(new Context(), { maxOwnerReassessmentsPerGate: value }) })
        .toThrow('maxOwnerReassessmentsPerGate must be a positive safe integer')
      await expect(setup({ config: { subagentProvider: 'fresh', maxOwnerReassessmentsPerGate: value } }))
        .rejects.toThrow()
    }
    for (const limit of [undefined, 1, 3]) {
      const h = await setup({ config: { subagentProvider: 'fresh', ...limit === undefined ? {} : { maxOwnerReassessmentsPerGate: limit } } })
      const result = await execute(h.ctx, baseArgs, h.parent)
      expect(result.isError).toBe(false)
      const event = h.parent.session.events.findLast(item => item.type === 'conductor/checkpoint')!
      const run = JSON.parse(event.data.record!) as ConductorRun
      expect(run.budget.maxOwnerReassessmentsPerGate).toBe(limit ?? 2)
      expect(run.ownerSessionId).toBe(h.parent.session.id)
      expect(run.ownerCapabilities).toEqual({ allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: [] })
    }
  })

  it('does not fabricate a child identity or question when the workflow publishes no child metadata', async () => {
    const h = await setup({ factory: (request) => {
      const args = request.args as { label: string; prompt: string }
      return { stopReason: 'completed', agentsStarted: 1, value: { ...readyEnvelope(promptRunId(args.prompt), 'detective'),
        status: 'blocked', blockers: ['Which evidence applies?'],
        change_requests: [{ target: 'plan', reason: 'Which evidence applies?', impact: 'Cannot complete.' }] } }
    } })
    h.engine.publishChildren = false
    const result = await execute(h.ctx, baseArgs, h.parent)
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked' } })
    const event = h.parent.session.events.findLast(item => item.type === 'conductor/checkpoint')!
    const run = JSON.parse(event.data.record!) as ConductorRun
    expect(run.ownerLedger).toEqual([])
    expect(h.engine.requests).toHaveLength(1)
  })

  it('refuses a Gate C command outside the exact owner-approved amendment', async () => {
    const command = { id: 'unit', modelSafeDescription: 'Run the unit check.', argv: [process.execPath, '-e', 'process.exit(0)'], cwd: '.',
      allowedStages: ['auditor' as const], sandboxMode: 'read-only' as const, timeoutMs: 1000, maxOutputBytes: 100, graceMs: 100 }
    let detective = 0
    const proposal = { allowedPaths: baseArgs.allowedPaths, excludedPaths: [], qualityCommandIds: ['unit'] }
    const h = await setup({ liveParent: true, config: { subagentProvider: 'fresh', qualityCommands: [command, { ...command, id: 'other' }] },
      factory: (request) => {
        const args = request.args as { label: string; prompt: string }
        const result = successfulResult(request)
        if (args.label === 'conductor-detective' && ++detective === 1) return { ...result,
          value: { ...readyEnvelope(promptRunId(args.prompt), 'detective'), status: 'blocked', blockers: ['Approve the exact command.'],
            change_requests: [{ target: 'authority', reason: 'Approve the exact command.', impact: 'Limit quality execution.', proposal }] } }
        if (args.label === 'conductor-devils-advocate') {
          const reply = result.value as Record<string, unknown>
          return { ...result, value: { ...reply,
            execution_baseline: { ...reply['execution_baseline'] as Record<string, unknown>, qualityCommandIds: ['other'] } } }
        }
        return result
      } })
    h.ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => Promise.resolve({
      source: 'scripted-test-provider', rootSessionId: h.parent.session.id, questionId: question.id, expectedRevision: run.ownerRevision,
      action: 'approve', answers: question.items.map(item => ({ itemId: item.id, text: 'Use only the approved command.' })),
      proposalHash: ownerMandateHash(proposal),
    }) })
    const result = await executeOwnerTask(h, baseArgs)
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'escalated', result: { kind: 'blocked', blocker: 'Gate C command selection exceeds the effective owner mandate' } })
    expect(h.engine.requests).toHaveLength(3)
    expect(h.parent.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(0)
  })

  it.each(['complete', 'interrupted'] as const)('flushes scripted answers and preserves exact same-run provenance when %s', async (boundary) => {
    let detectiveAttempts = 0
    const h = await setup({ liveParent: true, factory: (request) => {
      const args = request.args as { label: string }
      const result = analysisResult(request)
      if (args.label === 'conductor-detective' && ++detectiveAttempts === 1) {
        const reply: Record<string, unknown> = { ...result.value as Record<string, unknown>, status: 'blocked', blockers: ['Choose the evidence.'],
          clarifications: [{ id: 'evidence', prompt: 'Which evidence should be assessed?', options: [] }] }
        delete reply['candidate']
        return { ...result, value: reply }
      }
      return result
    } })
    h.ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => {
      expect(question.childId).toBe(SessionId('child-conductor-test-1'))
      expect(question.attempt).toBe(1)
      return Promise.resolve({ source: 'scripted-test-provider', rootSessionId: h.parent.session.id,
        questionId: question.id, expectedRevision: run.ownerRevision, action: 'answer_continue',
        answers: question.items.map(item => ({ itemId: item.id, text: 'Assess the supplied current request.' })) })
    } })
    const unmount = h.ctx.on('session/flush', (session) => {
      if (boundary === 'interrupted' && session.events.some(event => event.type === 'conductor/owner-continuation-consumed')) {
        throw new Error('Injected consumption persistence failure')
      }
    })
    const result = await executeOwnerTask(h, { ...baseArgs, purpose: 'analysis', deliverable: 'answer' })
    unmount()
    if (boundary === 'interrupted') {
      expect(result.isError).toBe(true)
      expect(JSON.stringify(result)).toContain('consumption boundary')
      expect(JSON.stringify(result)).not.toContain('No Conductor run was started')
      expect(detectiveAttempts).toBe(1)
      return
    }
    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(result.value).toMatchObject({ status: 'reported', result: { kind: 'report' } })
    const checkpoints = h.parent.session.events.filter(item => item.type === 'conductor/checkpoint')
      .map(event => JSON.parse(event.data.record!) as ConductorRun)
    expect(checkpoints.map(run => run.status)).toEqual(expect.arrayContaining(['awaiting_owner', 'continuation_pending', 'rework', 'reported']))
    const final = checkpoints.at(-1)!
    expect(new Set(checkpoints.map(run => run.runId)).size).toBe(1)
    expect(final.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'answer', 'consumed'])
    const children = h.parent.session.events.flatMap(event => event.type === 'conductor/child' && event.data.status === 'running'
      ? [{ role: event.data.role, attempt: event.data.attempt }] : [])
    expect(children.slice(0, 2))
      .toEqual([{ role: 'detective', attempt: 1 }, { role: 'detective', attempt: 2 }])
    expect(children).toContainEqual({ role: 'devils-advocate', attempt: 1 })
    expect(final.analysisChallenges).toHaveLength(1)
    expect(final.history.filter(gate => gate.gate === 'A').map(gate => gate.decision)).toEqual(['escalate', 'pass'])
    expect(final.executionAuthorization).toBeNull()
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
    expect(result.value).toMatchObject({ status: 'awaiting_owner', result: { run: {
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
      expect(result.value).toMatchObject({ status: 'awaiting_owner', result: { kind: 'blocked' } })
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
    for (const field of ['maxCriticInputTokensPerAttempt', 'maxCriticOutputTokensPerAttempt', 'maxCriticTokensPerRun'] as const) {
      for (const value of [0, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        expect(() => { toolConductor.apply(new Context(), { [field]: value }) }).toThrow(/positive safe integer/)
      }
    }
    expect(() => { toolConductor.apply(new Context(), { maxCriticInputTokensPerAttempt: 25_000,
      maxCriticOutputTokensPerAttempt: 16_000, maxCriticTokensPerRun: 40_000 }) }).toThrow(/cover one maximum/)

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
      expect(result.value).toMatchObject({ status: 'awaiting_owner', result: { kind: 'blocked' } })
    }

    const unestablished = await setup({
      factory: () => ({ stopReason: 'completed', agentsStarted: 1, value: null }),
    })
    const unestablishedResult = await execute(unestablished.ctx, {
      ...intakeArgs, objective: 'Establish the baseline.', authority: { owner: 'user' },
    }, unestablished.parent)
    expect(unestablishedResult.value).toMatchObject({ status: 'awaiting_owner', result: { kind: 'blocked' } })

    const arbiterEmpty = await setup({
      factory: (request) => {
        const args = request.args as { label?: string }
        return args.label === 'conductor-arbiter'
          ? { stopReason: 'completed', agentsStarted: 1, value: null }
          : successfulResult(request)
      },
    })
    const arbiterResult = await execute(arbiterEmpty.ctx, baseArgs, arbiterEmpty.parent)
    expect(arbiterResult.value).toMatchObject({ status: 'awaiting_owner', result: { kind: 'blocked' } })

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

    const unavailable = await setup()
    const unavailableLoad = vi.spyOn(SessionConductorRunStore.prototype, 'load')
      .mockRejectedValueOnce(new ConductorRunUnavailableError(ConductorRunId('CON-2026-0004'), 4))
    const retry = await execute(unavailable.ctx, baseArgs, unavailable.parent)
    expect(retry.isError, JSON.stringify(retry)).toBe(false)
    expect(unavailableLoad).toHaveBeenCalledTimes(2)
    unavailableLoad.mockRestore()

    const storageFailure = await setup()
    const failedLoad = vi.spyOn(SessionConductorRunStore.prototype, 'load')
      .mockRejectedValueOnce(new Error('synthetic storage failure'))
    const failed = await execute(storageFailure.ctx, baseArgs, storageFailure.parent)
    expect(failed.isError).toBe(true)
    expect(JSON.stringify(failed.content)).toContain('synthetic storage failure')
    failedLoad.mockRestore()

    const exhausted = await setup()
    const occupiedLoad = vi.spyOn(SessionConductorRunStore.prototype, 'load')
      .mockRejectedValue(new ConductorRunUnavailableError(ConductorRunId('CON-2026-0004'), 4))
    const noId = await execute(exhausted.ctx, baseArgs, exhausted.parent)
    expect(noId.isError).toBe(true)
    expect(JSON.stringify(noId.content)).toContain('Unable to mint an unused Conductor runId after 9 attempts')
    expect(occupiedLoad).toHaveBeenCalledTimes(9)
    occupiedLoad.mockRestore()

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
