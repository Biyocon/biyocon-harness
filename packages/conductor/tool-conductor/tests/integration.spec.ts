import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import UserApproval from '@deepseek-ai/dsh-user-approval'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import type { ResolvedSubagentStartRequest, SubagentProvider, SubagentRun } from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import WorkflowWorker from '@deepseek-ai/dsh-workflow-worker-thread'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import * as toolConductor from '../src/index.ts'
import { canonicalAbsolute } from '../src/path-policy.ts'
import { mountQualityServices, RecordingSubprocess } from './quality-services.ts'

const testToolSignal = new AbortController().signal
const realSpawnTimeoutMs = 30_000

async function mountExecutionApproval(
  ctx: Context,
  outcome: ApprovalOutcome = 'allowed-once',
  reasons: string[] = [],
): Promise<void> {
  await ctx.plugin(UserApproval, { policy: 'ask' })
  ctx.on('approval/request', (request) => {
    reasons.push(request.reason ?? '')
    return Promise.resolve(outcome)
  })
}

/** Extract the run id the Conductor tool embedded in one child's dispatch prompt. */
function promptText(options: GenerateOptions): string {
  return options.messages
    .flatMap(message => message.content)
    .filter(block => block.type === 'text')
    .map(block => (block as { text: string }).text)
    .join('\n')
}

/** Extract the run id the Conductor tool embedded in one child's dispatch prompt. */
function extractRunId(options: GenerateOptions): string {
  const text = promptText(options)
  return /"run_id"\s*:\s*"(CON-\d{4}-\d{4})"/.exec(text)?.[1] ?? 'CON-0000-0000'
}

function readyEnvelope(
  runId: string,
  stage: string,
  qualityEvidenceIds: string[] = [],
  qualityCommandIds: string[] = [],
): Record<string, unknown> {
  return {
    run_id: runId,
    stage,
    baseline_ref: 'HEAD',
    ...(stage === 'detective' ? { source_baseline: 'HEAD' } : {}),
    status: 'ready',
    summary: `${stage} done`,
    evidence: [{ kind: 'test', reference: `${stage}-check`, outcome: 'passed' }],
    findings: [],
    assumptions: [],
    blockers: [],
    artifacts: [],
    change_requests: [],
    quality_evidence_ids: qualityEvidenceIds,
    recommended_transition: { target: 'conductor', rationale: 'evaluate' },
    confidence: 'high',
    ...(stage === 'devils-advocate' ? {
      execution_baseline: {
        scopeVersion: 'scope-1',
        planVersion: 'plan-1',
        acceptanceVersion: 'accept-1',
        rollbackReference: 'HEAD',
        qualityCommandIds,
      },
    } : {}),
  }
}

function extractQualityEvidenceId(options: GenerateOptions): string {
  const strings: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === 'string') strings.push(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit)
  }
  visit(options.messages)
  const matches = strings.flatMap(value => [...value.matchAll(/"(?:evidenceId|evidence_id)"\s*:\s*"([^"]+)"/g)])
  const evidenceId = matches.at(-1)?.[1]
  if (evidenceId === undefined) throw new Error('quality evidence id is missing from the child prompt')
  return evidenceId
}

function goDecision(runId: string): Record<string, unknown> {
  return {
    run_id: runId,
    decision: 'go',
    basis: ['evidence meets criteria'],
    evidence_reviewed: ['delivery package'],
    conditions: [],
    open_risks: [],
    required_follow_up: [],
  }
}

function openApprovalTurn(agent: Agent): void {
  agent.session.append('turn/start', { turn: 1 })
}

describe('dsh-tool-conductor over the real spawn stack', () => {
  it('rejects a provider that cannot apply the required child persona', async () => {
    const ctx = new Context()
    await mountAgentLoopTestDependencies(ctx)
    await mountQualityServices(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    const provider: SubagentProvider = {
      name: 'persona-less',
      capabilities: {
        outputSchema: true, depthLimit: true, toolFilter: true, toolGuard: true, persona: false, toolContribution: false,
      },
      inheritsParentContext: false,
      start(_request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
        throw new Error('persona-less provider must be rejected before start')
      },
    }
    ctx.subagents.registerProvider(provider)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(WorkflowWorker, { provider: provider.name })
    let failure: unknown
    try {
      await ctx.plugin(toolConductor, { subagentProvider: provider.name })
    } catch (cause) {
      failure = cause
    }
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toMatch(/child personas/)
  })

  it('drives every specialist as a fresh child and returns the Arbiter GO decision', async () => {
    const beforeRalph = ['detective', 'strategist', 'devils-advocate'] as const
    const afterRalph = ['headsman', 'auditor', 'integrator'] as const
    const script: ((options: GenerateOptions) => ReturnType<typeof toolCallResponse>)[] = [
      ...beforeRalph.map(stage => (options: GenerateOptions) => {
        if (stage === 'strategist') expect(promptText(options)).toContain('detective done')
        return toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))
      }),
      () => toolCallResponse('ralph-round', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        summary: 'bounded implementation round complete',
        evidence: ['Ralph worker evidence'],
        nextSteps: [],
        blocker: '',
      }),
      ...afterRalph.map(stage => (options: GenerateOptions) =>
        toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))),
      (options: GenerateOptions) => {
        expect(promptText(options)).toContain('"specialist_reports"')
        expect(promptText(options)).toContain('integrator done')
        return toolCallResponse('arbiter', STRUCTURED_OUTPUT_TOOL, goDecision(extractRunId(options)))
      },
    ]
    const ctx = new Context()
    const adapter = new MockAdapter(script)
    await mountAgentLoopTestDependencies(ctx)
    await mountQualityServices(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    const approvalReasons: string[] = []
    await mountExecutionApproval(ctx, 'allowed-once', approvalReasons)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
    ctx.on('session/flush', () => {})
    for (const name of [
      'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate',
      'conductor-headsman', 'conductor-auditor', 'conductor-integrator', 'conductor-arbiter',
      'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
    ]) {
      ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
    }
    await ctx.plugin(toolConductor, { subagentProvider: 'spawn', maxRalphRounds: 1 })
    for (const name of ['read', 'read_image', 'grep', 'glob', 'write', 'edit']) {
      ctx.tools.register(defineContentToolFixture({
        name, description: name, parameters: {},
        execute: () => Promise.resolve([{ type: 'text', text: name }]),
      }))
    }
    ctx.llm.registerAdapter(['mock'], adapter)

    const parent = ctx.agentLoop.create(
      SessionId('conductor-parent'),
      { provider: 'mock', model: 'mock' },
      { cwd: process.cwd() },
    )
    openApprovalTurn(parent)
    const children: Agent[] = []
    ctx.on('subagent/start', (info) => {
      const agent = ctx.agents.get(info.id)
      if (agent !== undefined) children.push(agent)
    })

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-integration'),
      name: 'conductor',
      arguments: {
        objective: 'Ship the feature through the full gate chain.',
        acceptanceCriteria: ['all specialist gates have evidence'],
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user' },
      },
      agent: parent,
    })

    expect(result.isError, JSON.stringify(result)).toBe(false)
    expect(approvalReasons).toHaveLength(1)
    expect(approvalReasons[0]).toMatch(/execution_baseline_hash/)
    expect(approvalReasons[0]).toContain(
      JSON.stringify(canonicalAbsolute(process.cwd(), 'packages/conductor')).slice(1, -1),
    )
    expect((result.content[0] as { text: string }).text).toContain('Conductor reached the Arbiter')
    expect(children).toHaveLength(8)
    for (const child of children) {
      expect(child.session.header.parentSession).toBe(parent.session.header.id)
      expect(ctx.agents.get(child.id)).toBeUndefined()
    }

    const checkpoint = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)
    expect(checkpoint).toBeDefined()
    if (checkpoint?.type !== 'conductor/checkpoint') throw new Error('missing Conductor checkpoint')
    const modelCloseout = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-closeout'),
      name: 'conductor',
      arguments: {
        runId: checkpoint.data.runId,
        objective: 'Ship the feature through the full gate chain.',
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user' },
        closeoutAuthorization: {
          authorizedBy: 'user',
          action: 'record-only',
          actionsTaken: ['recorded the verified GO'],
          outcomeEvidence: ['Gate G checkpoint'],
          unverifiedItems: [],
          openRisks: [],
          followUp: [],
          traceability: {
            mandate: ['tool input'], baseline: ['HEAD'], changes: [],
            verification: ['Auditor envelope'], decision: ['Gate G'],
          },
        },
      },
      agent: parent,
    })
    expect(modelCloseout.isError).toBe(true)

    const modelExecutionAuthority = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-model-execution-authority'),
      name: 'conductor',
      arguments: {
        runId: checkpoint.data.runId,
        objective: 'Ship the feature through the full gate chain.',
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user', permittedActions: ['write'], executionPermissions: ['quality-execute'] },
      },
      agent: parent,
    })
    expect(modelExecutionAuthority.isError).toBe(true)

    const awaitingHost = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-awaiting-host-closeout'),
      name: 'conductor',
      arguments: {
        runId: checkpoint.data.runId,
        objective: 'Ship the feature through the full gate chain.',
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user' },
      },
      agent: parent,
    })
    expect(awaitingHost.isError, JSON.stringify(awaitingHost)).toBe(false)
    expect((awaitingHost.content[0] as { text: string }).text).toContain('host-side authorization through closeRun')

    const blankCriterion = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-blank-criterion'),
      name: 'conductor',
      arguments: {
        objective: 'Reject blank criteria before dispatch.',
        acceptanceCriteria: [''],
        authority: { owner: 'user' },
      },
      agent: parent,
    })
    expect(blankCriterion.isError).toBe(true)
    expect((blankCriterion.content[0] as { text: string }).text).toMatch(/acceptanceCriteria.*non-empty normalized strings/)
  }, realSpawnTimeoutMs)

  it.each(['rejected', 'cancelled', 'unavailable'] as const)(
    'does not start a write-capable or quality child when Gate C approval is %s',
    async (approvalOutcome) => {
      const script: ((options: GenerateOptions) => ReturnType<typeof toolCallResponse>)[] = [
        ...(['detective', 'strategist'] as const).map(stage => (options: GenerateOptions) =>
          toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))),
        (options: GenerateOptions) => toolCallResponse(
          'devils-advocate',
          STRUCTURED_OUTPUT_TOOL,
          readyEnvelope(extractRunId(options), 'devils-advocate', [], ['unit-check']),
        ),
      ]
      const ctx = new Context()
      const adapter = new MockAdapter(script)
      await mountAgentLoopTestDependencies(ctx)
      await mountQualityServices(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await mountExecutionApproval(ctx, approvalOutcome)
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(spawn, { providerName: 'spawn' })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
      ctx.on('session/flush', () => {})
      for (const name of [
        'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate', 'conductor-specialist',
      ]) {
        ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
      }
      await ctx.plugin(toolConductor, {
        subagentProvider: 'spawn',
        qualityCommands: [{
          id: 'unit-check',
          modelSafeDescription: 'Run the focused unit check.',
          argv: ['node', '--version'],
          cwd: '.',
          allowedStages: ['headsman'],
          sandboxMode: 'read-only',
          timeoutMs: 1000,
          maxOutputBytes: 4096,
          graceMs: 100,
        }],
      })
      for (const name of ['read', 'read_image', 'grep', 'glob', 'write', 'edit']) {
        ctx.tools.register(defineContentToolFixture({
          name, description: name, parameters: {},
          execute: () => Promise.resolve([{ type: 'text', text: name }]),
        }))
      }
      ctx.llm.registerAdapter(['mock'], adapter)
      const parent = ctx.agentLoop.create(
        SessionId(`conductor-approval-${approvalOutcome}`),
        { provider: 'mock', model: 'mock' },
        { cwd: process.cwd() },
      )
      openApprovalTurn(parent)
      const children: Agent[] = []
      ctx.on('subagent/start', (info) => {
        const agent = ctx.agents.get(info.id)
        if (agent !== undefined) children.push(agent)
      })

      const result = await ctx.tools.execute({
        signal: testToolSignal,
        callId: CallId(`conductor-approval-${approvalOutcome}`),
        name: 'conductor',
        arguments: {
          objective: 'Stop before execution unless the host approves the exact baseline.',
          acceptanceCriteria: ['No execution without host approval'],
          allowedPaths: ['packages/conductor'],
          authority: { owner: 'user' },
        },
        agent: parent,
      })

      expect(result.isError, JSON.stringify(result)).toBe(false)
      expect((result.content[0] as { text: string }).text).toMatch(/execution authorization/)
      expect(children).toHaveLength(3)
      expect((ctx.subprocess as RecordingSubprocess).specs).toEqual([])
      expect(parent.session.events.filter(event => event.type === 'approval/asked')).toHaveLength(1)
      expect(parent.session.events.filter(event => event.type === 'approval/decided')).toMatchObject([
        { data: { outcome: approvalOutcome } },
      ])
    },
    realSpawnTimeoutMs,
  )

  it('runs bounded quality commands under Ralph and an independent Auditor before Gate D and E pass', async () => {
    const script: ((options: GenerateOptions) => ReturnType<typeof toolCallResponse>)[] = [
      ...(['detective', 'strategist'] as const).map(stage => (options: GenerateOptions) =>
        toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))),
      (options: GenerateOptions) => toolCallResponse(
        'devils-advocate',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'devils-advocate', [], ['unit-check']),
      ),
      (options: GenerateOptions) => {
        expect(promptText(options)).toContain('"id": "unit-check"')
        expect(promptText(options)).toContain('Run the focused unit check.')
        expect(promptText(options)).toContain('"execution_baseline"')
        expect(promptText(options)).toContain('"rollbackReference": "HEAD"')
        expect(promptText(options)).toContain('"requiredGates"')
        return toolCallResponse('ralph-quality', 'conductor_quality_check', { command_id: 'unit-check' })
      },
      () => toolCallResponse('ralph-report', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        summary: 'bounded implementation and quality command complete',
        evidence: ['Host quality evidence is available to Headsman.'],
        nextSteps: [],
        blocker: '',
      }),
      (options: GenerateOptions) => toolCallResponse(
        'headsman',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'headsman', [extractQualityEvidenceId(options)]),
      ),
      () => toolCallResponse('auditor-quality', 'conductor_quality_check', { command_id: 'unit-check' }),
      (options: GenerateOptions) => toolCallResponse(
        'auditor',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'auditor', [extractQualityEvidenceId(options)]),
      ),
      (options: GenerateOptions) => toolCallResponse(
        'integrator',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'integrator'),
      ),
      (options: GenerateOptions) => toolCallResponse(
        'arbiter',
        STRUCTURED_OUTPUT_TOOL,
        goDecision(extractRunId(options)),
      ),
    ]
    const ctx = new Context()
    const adapter = new MockAdapter(script)
    await mountAgentLoopTestDependencies(ctx)
    await mountQualityServices(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountExecutionApproval(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
    ctx.on('session/flush', () => {})
    for (const name of [
      'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate',
      'conductor-headsman', 'conductor-auditor', 'conductor-integrator', 'conductor-arbiter',
      'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
    ]) {
      ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
    }
    await ctx.plugin(toolConductor, {
      subagentProvider: 'spawn',
      maxRalphRounds: 1,
      qualityCommands: [{
        id: 'unit-check',
        modelSafeDescription: 'Run the focused unit check.',
        argv: ['node', '--version'],
        cwd: '.',
        allowedStages: ['headsman', 'auditor'],
        sandboxMode: 'read-only',
        timeoutMs: 1000,
        maxOutputBytes: 4096,
        graceMs: 100,
      }],
    })
    for (const name of ['read', 'read_image', 'grep', 'glob', 'write', 'edit']) {
      ctx.tools.register(defineContentToolFixture({
        name, description: name, parameters: {},
        execute: () => Promise.resolve([{ type: 'text', text: name }]),
      }))
    }
    ctx.llm.registerAdapter(['mock'], adapter)
    const parent = ctx.agentLoop.create(
      SessionId('conductor-quality-parent'),
      { provider: 'mock', model: 'mock' },
      { cwd: process.cwd() },
    )
    openApprovalTurn(parent)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-quality-integration'),
      name: 'conductor',
      arguments: {
        objective: 'Ship only after bounded implementation and independent verification.',
        acceptanceCriteria: ['Headsman and Auditor quality checks pass'],
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user' },
      },
      agent: parent,
    })

    expect(result.isError, JSON.stringify(result)).toBe(false)
    const latestRecord = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)
    expect(
      (result.content[0] as { text: string }).text,
      latestRecord?.type === 'conductor/checkpoint' ? String(latestRecord.data.record) : JSON.stringify(result),
    ).toContain('Conductor reached the Arbiter')
    const subprocess = ctx.subprocess as RecordingSubprocess
    expect(subprocess.specs.map(spec => spec.argv)).toEqual([
      ['node', '--version'],
      ['node', '--version'],
    ])
    const checkpoint = latestRecord
    if (checkpoint?.type !== 'conductor/checkpoint' || checkpoint.data.record === null) {
      throw new Error('missing quality Conductor checkpoint')
    }
    const record = JSON.parse(checkpoint.data.record) as {
      qualityExecutions: { gate: string; executorStage: string; childSessionId: string; outcome: string }[]
    }
    expect(record.qualityExecutions).toMatchObject([
      { gate: 'D', executorStage: 'ralph', outcome: 'passed' },
      { gate: 'E', executorStage: 'auditor', outcome: 'passed' },
    ])
    expect(record.qualityExecutions[0]!.childSessionId)
      .not.toBe(record.qualityExecutions[1]!.childSessionId)
  }, realSpawnTimeoutMs)

  it('records an invalid Gate C quality-command selection as a blocked checkpoint', async () => {
    const script: ((options: GenerateOptions) => ReturnType<typeof toolCallResponse>)[] = [
      ...(['detective', 'strategist'] as const).map(stage => (options: GenerateOptions) =>
        toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))),
      (options: GenerateOptions) => toolCallResponse(
        'devils-advocate',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'devils-advocate', [], ['unknown-check']),
      ),
    ]
    const ctx = new Context()
    const adapter = new MockAdapter(script)
    await mountAgentLoopTestDependencies(ctx)
    await mountQualityServices(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountExecutionApproval(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
    ctx.on('session/flush', () => {})
    for (const name of [
      'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate',
      'conductor-headsman', 'conductor-auditor', 'conductor-integrator', 'conductor-arbiter',
      'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
    ]) {
      ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
    }
    await ctx.plugin(toolConductor, {
      subagentProvider: 'spawn',
      qualityCommands: [{
        id: 'unit-check',
        modelSafeDescription: 'Run the focused unit check.',
        argv: ['node', '--version'],
        cwd: '.',
        allowedStages: ['headsman'],
        sandboxMode: 'read-only',
        timeoutMs: 1000,
        maxOutputBytes: 4096,
        graceMs: 100,
      }],
    })
    for (const name of ['read', 'read_image', 'grep', 'glob']) {
      ctx.tools.register(defineContentToolFixture({
        name, description: name, parameters: {},
        execute: () => Promise.resolve([{ type: 'text', text: name }]),
      }))
    }
    ctx.llm.registerAdapter(['mock'], adapter)
    const parent = ctx.agentLoop.create(
      SessionId('conductor-invalid-gate-c-parent'),
      { provider: 'mock', model: 'mock' },
      { cwd: process.cwd() },
    )
    openApprovalTurn(parent)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-invalid-gate-c'),
      name: 'conductor',
      arguments: {
        objective: 'Reject a model-selected command outside the deployment catalog.',
        acceptanceCriteria: ['Gate C records the invalid specialist output'],
        allowedPaths: ['packages/conductor'],
        sourceBaseline: 'HEAD',
        authority: { owner: 'user' },
      },
      agent: parent,
    })

    expect(result.isError, JSON.stringify(result)).toBe(false)
    const checkpoint = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)
    if (checkpoint?.type !== 'conductor/checkpoint' || checkpoint.data.record === null) {
      throw new Error('missing invalid Gate C checkpoint')
    }
    const record = JSON.parse(checkpoint.data.record) as {
      status: string
      history: { gate: string; decision: string; basis: string[] }[]
    }
    expect(record.status, JSON.stringify(record)).toBe('escalated')
    expect(record.history.find(gate => gate.gate === 'C'), JSON.stringify(record)).toMatchObject({
      gate: 'C',
      decision: 'rework',
      basis: expect.arrayContaining(['Gate C selected unknown quality command "unknown-check"']) as unknown,
    })
    expect(record.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate' })
  }, realSpawnTimeoutMs)

  it.each(['transport', 'dispose'] as const)('durably checkpoints quality evidence after specialist %s failure', async (failure) => {
    const script: ((options: GenerateOptions) => ReturnType<typeof toolCallResponse>)[] = [
      ...(['detective', 'strategist'] as const).map(stage => (options: GenerateOptions) =>
        toolCallResponse(stage, STRUCTURED_OUTPUT_TOOL, readyEnvelope(extractRunId(options), stage))),
      (options: GenerateOptions) => toolCallResponse(
        'devils-advocate',
        STRUCTURED_OUTPUT_TOOL,
        readyEnvelope(extractRunId(options), 'devils-advocate', [], ['unit-check']),
      ),
      () => toolCallResponse('ralph-quality', 'conductor_quality_check', { command_id: 'unit-check' }),
      () => toolCallResponse('ralph-report', STRUCTURED_OUTPUT_TOOL, {
        status: 'complete',
        summary: 'quality command completed before the specialist failure',
        evidence: ['Host quality evidence is available to Headsman.'],
        nextSteps: [],
        blocker: '',
      }),
      (options: GenerateOptions) => {
        if (failure === 'transport') throw new Error('simulated specialist transport failure')
        return toolCallResponse('headsman', STRUCTURED_OUTPUT_TOOL,
          readyEnvelope(extractRunId(options), 'headsman', [extractQualityEvidenceId(options)]))
      },
    ]
    const ctx = new Context()
    const adapter = new MockAdapter(script)
    await mountAgentLoopTestDependencies(ctx)
    await mountQualityServices(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await mountExecutionApproval(ctx)
    await ctx.plugin(SubagentRuntime)
    await ctx.plugin(spawn, { providerName: 'spawn' })
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
    ctx.on('session/flush', () => {})
    for (const name of [
      'conductor-detective', 'conductor-strategist', 'conductor-devils-advocate',
      'conductor-headsman', 'conductor-auditor', 'conductor-integrator', 'conductor-arbiter',
      'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
    ]) {
      ctx.skills.register({ name, description: name, content: `${name} instructions`, source: 'test' })
    }
    await ctx.plugin(toolConductor, {
      subagentProvider: 'spawn',
      maxRalphRounds: 1,
      qualityCommands: [{
        id: 'unit-check',
        modelSafeDescription: 'Run the focused unit check.',
        argv: ['node', '--version'],
        cwd: '.',
        allowedStages: ['headsman'],
        sandboxMode: 'read-only',
        timeoutMs: 1000,
        maxOutputBytes: 4096,
        graceMs: 100,
      }],
    })
    for (const name of ['read', 'read_image', 'grep', 'glob', 'write', 'edit']) {
      ctx.tools.register(defineContentToolFixture({
        name, description: name, parameters: {},
        execute: () => Promise.resolve([{ type: 'text', text: name }]),
      }))
    }
    ctx.llm.registerAdapter(['mock'], adapter)
    if (failure === 'dispose') {
      const start = ctx.workflowEngine.start.bind(ctx.workflowEngine)
      vi.spyOn(ctx.workflowEngine, 'start').mockImplementation((request) => {
        const workflow = start(request)
        if ((request.args as { label?: string }).label !== 'conductor-headsman') return workflow
        return { ...workflow, dispose: async () => {
          await workflow.dispose()
          throw new Error('simulated workflow disposal failure')
        } }
      })
    }
    const parent = ctx.agentLoop.create(
      SessionId('conductor-quality-failure-parent'),
      { provider: 'mock', model: 'mock' },
      { cwd: process.cwd() },
    )
    openApprovalTurn(parent)

    const result = await ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId('conductor-quality-failure-integration'),
      name: 'conductor',
      arguments: {
        objective: 'Preserve host evidence across a specialist failure.',
        acceptanceCriteria: ['Completed quality commands remain durable'],
        allowedPaths: ['packages/conductor'],
        authority: { owner: 'user' },
      },
      agent: parent,
    })

    expect(result.isError, JSON.stringify(result)).toBe(false)
    const checkpoint = parent.session.events.filter(event => event.type === 'conductor/checkpoint').at(-1)
    if (checkpoint?.type !== 'conductor/checkpoint' || checkpoint.data.record === null) {
      throw new Error('missing failed-specialist Conductor checkpoint')
    }
    const record = JSON.parse(checkpoint.data.record) as {
      status: string
      history: { gate: string; decision: string }[]
      qualityExecutions: { gate: string; executorStage: string; outcome: string }[]
    }
    expect(record.status).toBe('escalated')
    expect(record.history.at(-1)).toMatchObject({ gate: 'D', decision: 'escalate' })
    expect(record.qualityExecutions).toMatchObject([
      { gate: 'D', executorStage: 'ralph', outcome: 'passed' },
    ])
  }, realSpawnTimeoutMs)
})
