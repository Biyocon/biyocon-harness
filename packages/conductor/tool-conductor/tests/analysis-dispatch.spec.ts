import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { admitIntake, captureIntakeMaterial, ConductorRunId, createRun, reportHash } from '@deepseek-ai/dsh-conductor'
import * as conductorPresets from '@deepseek-ai/dsh-conductor-presets'
import type { ReportCandidate } from '@deepseek-ai/dsh-conductor'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import WorkflowWorker from '@deepseek-ai/dsh-workflow-worker-thread'
import { WorkflowEngine, WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun, WorkflowStartRequest } from '@deepseek-ai/dsh-workflow'
import { describe, expect, it } from 'vitest'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { dispatchAnalysisChild } from '../src/analysis-dispatch.ts'
import { toolAdmission } from './intake-fixtures.ts'

const material = captureIntakeMaterial('current-request', 'First admitted line.\nSecond admitted line.',
  { sessionId: SessionId('critic-parent'), eventIndex: 1 })
const candidate: ReportCandidate = {
  version: 'candidate-1', deliverable: 'answer', content: 'The recommendation follows.',
  criteria: [{ criterion: 'Explain the choice.', outcome: 'The choice follows the cited evidence.' }],
  material_ids: [material.id], material_spans: [{ material_id: material.id, start_line: 2, end_line: 2 }],
  assumptions: [], limitations: [],
}

function modelPrompt(options: GenerateOptions): {
  identity: Record<string, unknown>
  instructions: string
  excerpts: Array<{ text: string }>
} {
  const block = options.messages.flatMap(message => message.content)
    .find(value => value.type === 'text' && value.text.startsWith('{"identity":'))
  if (block?.type !== 'text') throw new Error('critic prompt was not sent to the model')
  return JSON.parse(block.text) as ReturnType<typeof modelPrompt>
}

class NoChildEngine extends WorkflowEngine {
  request: WorkflowStartRequest | undefined

  start(request: WorkflowStartRequest): WorkflowRun {
    this.request = request
    return {
      id: WorkflowRunId('no-child'), meta: request.meta,
      result: Promise.resolve({ stopReason: 'completed', value: null, agentsStarted: 0 }),
      cancel: () => {}, dispose: () => Promise.resolve(),
    }
  }
}

async function noChildSetup() {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SkillRegistry)
  await ctx.plugin(NoChildEngine)
  const parent = ctx.agentLoop.create(SessionId('critic-parent'), { provider: 'mock', model: 'mock' })
  const admission = admitIntake({ purpose: 'analysis', entry: 'devils-advocate', deliverable: 'answer',
    rationale: 'Review one admitted answer.' }, [material])
  const run = createRun(ConductorRunId('CON-2026-1234'), { admission, objective: 'Answer the request.',
    authority: { owner: 'user' }, acceptanceCriteria: ['Explain the choice.'] })
  const request = { mode: 'critic' as const, ctx, providerName: 'spawn', parent,
    signal: new AbortController().signal, run, candidate, producerChildId: 'producer-1', criticAttempt: 1,
    materialSpans: [{ material_id: material.id, start_line: 2, end_line: 2 }], previous: [],
    maxInputTokens: 10_000, maxOutputTokens: 32, maxSummaryCharacters: 1000,
    countTokens: (prompt: string) => Math.ceil(prompt.length / 4),
  }
  return { ctx, request, engine: ctx.workflowEngine as NoChildEngine }
}

describe('prepared analysis critic over the real workflow and spawn stack', () => {
  it.each(['holds', 'holds-detective-recommendations', 'invalid-report', 'stale-candidate'] as const)(
    'binds the reserved identity and classifies a %s result', async (caseName) => {
      const detectiveRecommendations = caseName === 'holds-detective-recommendations'
      const selectedCandidate: ReportCandidate = detectiveRecommendations
        ? { ...candidate, deliverable: 'recommendations' } : candidate
      let observedId: SessionId | undefined
      let observedChild: Agent | undefined
      let observedPrompt: ReturnType<typeof modelPrompt> | undefined
      let measuredText: string | undefined
      let observedRaw: unknown
      const adapter = new MockAdapter([(options) => {
        const prompt = modelPrompt(options)
        observedPrompt = prompt
        const challenge = {
          run_id: prompt.identity.run_id, purpose: 'analysis',
          candidate_hash: caseName === 'stale-candidate' ? '0'.repeat(64) : prompt.identity.candidate_hash,
          candidate_version: prompt.identity.candidate_version,
          material_ids: prompt.identity.material_ids,
          critic_child_id: prompt.identity.critic_child_id,
          critic_attempt: prompt.identity.critic_attempt,
          findings: caseName === 'invalid-report' ? [{ id: 'f1', severity: 'major', claim: 'Risk', rationale: 'Unresolved',
            material_ids: [material.id] }] : [],
          conclusion: 'holds', summary: 'Review complete.',
        }
        return toolCallResponse('critic-result', STRUCTURED_OUTPUT_TOOL, challenge)
      }], undefined, 100, true)
      const ctx = new Context()
      await mountAgentLoopTestDependencies(ctx)
      await ctx.plugin(AgentLoop, { agents: [] })
      await ctx.plugin(SubagentRuntime)
      await ctx.plugin(spawn, { providerName: 'spawn' })
      await ctx.plugin(SkillRegistry)
      await ctx.plugin(WorkflowWorker, { provider: 'spawn' })
      ctx.tools.register(defineContentToolFixture({ name: 'read', description: 'workspace read', parameters: {},
        execute: () => Promise.resolve([{ type: 'text', text: 'unadmitted content' }]) }))
      ctx.llm.registerAdapter(['mock'], adapter)
      await ctx.plugin(conductorPresets, {
        rolesDirectory: resolve('.agents/conductor/roles'),
        protocolDirectory: resolve('.agents/skills'),
        sharedProtocolFile: resolve('.agents/conductor/README.md'),
      })
      const parent = ctx.agentLoop.create(SessionId('critic-parent'), { provider: 'mock', model: 'mock' })
      ctx.on('workflow/agent-start', (_info, child) => {
        observedId = child.childId
        observedChild = ctx.agents.get(child.childId)
      })
      const admission = admitIntake({ purpose: 'analysis', entry: detectiveRecommendations ? 'detective' : 'devils-advocate',
        deliverable: detectiveRecommendations ? 'recommendations' : 'answer',
        rationale: 'Review one admitted answer.' }, [material])
      const run = createRun(ConductorRunId('CON-2026-1234'), { admission, objective: 'Answer the request.',
        authority: { owner: 'user' }, acceptanceCriteria: ['Explain the choice.'] })
      const result = await dispatchAnalysisChild({ mode: 'critic', ctx, providerName: 'spawn', parent,
        signal: new AbortController().signal, run, candidate: selectedCandidate, producerChildId: 'producer-1', criticAttempt: 1,
        materialSpans: [{ material_id: material.id, start_line: 2, end_line: 2 }], previous: [],
        maxInputTokens: 10_000, maxOutputTokens: 32, maxSummaryCharacters: 1000,
        countTokens: (prompt) => {
          measuredText = prompt
          return Math.ceil(prompt.length / 4)
        },
        onRawResult: (value) => { observedRaw = value },
      })
      expect(observedRaw).toMatchObject({ critic_child_id: observedId,
        candidate_version: selectedCandidate.version })
      expect(adapter.requests).toHaveLength(1)
      const modelRequest = adapter.requests[0]
      if (modelRequest === undefined) throw new Error('critic model request is missing')
      expect(modelRequest.sessionId).toBe(observedPrompt?.identity.critic_child_id)
      expect(modelRequest.maxTokens).toBe(32)
      expect(modelRequest.requireOutputTokenLimit).toBe(true)
      expect(modelRequest.tools?.map(tool => tool.name)).toEqual([STRUCTURED_OUTPUT_TOOL])
      expect(modelRequest.system).toContain('In an analysis critic dispatch')
      expect(modelRequest.system).toContain('Only for a typed critic dispatch')
      expect(modelRequest.system).not.toContain('Ved `admission.purpose: analysis`')
      expect(measuredText).toContain('In an analysis critic dispatch')
      expect(measuredText).toContain('Only for a typed critic dispatch')
      expect(observedId).toBe(observedPrompt?.identity.critic_child_id)
      expect(observedChild?.session.events.some(event => event.type === 'user/message'
        && event.data.content.some(block => block.type === 'text' && block.text.startsWith('{"identity":')))).toBe(true)
      expect(observedPrompt?.identity).toEqual({
        run_id: run.runId, candidate_hash: reportHash(selectedCandidate), candidate_version: selectedCandidate.version,
        critic_child_id: observedId, critic_attempt: 1, material_ids: [material.id],
      })
      expect(observedPrompt?.excerpts).toEqual([{ material_id: material.id, start_line: 2,
        end_line: 2, text: 'Second admitted line.' }])
      expect(observedPrompt?.instructions).toBe('Return one AnalysisChallenge for the supplied identity and admitted excerpts.')
      if (caseName === 'holds' || detectiveRecommendations) {
        expect(result).toMatchObject({ challenge: { conclusion: 'holds' }, reworkTarget: undefined })
      } else {
        expect(result).toMatchObject({ problem: { kind: caseName === 'invalid-report' ? 'report' : 'authority' } })
      }
    }, 30_000,
  )

  it('rejects a non-analysis run before dispatch', async () => {
    const { request, engine } = await noChildSetup()
    const run = createRun(ConductorRunId('CON-2026-1234'), { admission: toolAdmission(),
      objective: 'Implement.', authority: { owner: 'user' } })
    await expect(dispatchAnalysisChild({ ...request, run })).rejects.toThrow('requires an analysis run')
    expect(engine.request).toBeUndefined()
  })

  it.each(['missing', 'invalid'] as const)('rejects %s critic metadata before dispatch', async (kind) => {
    const { ctx, request, engine } = await noChildSetup()
    for (const name of ['conductor-devils-advocate', 'conductor-specialist']) {
      ctx.skills.register({ name, description: name, content: 'producer', source: 'test',
        ...(kind === 'invalid' ? { metadata: { analysisCritic: { dispatchMode: 'producer', instructions: 'text' } } } : {}),
      })
    }
    await expect(dispatchAnalysisChild(request)).rejects.toThrow(/analysis critic instructions/)
    expect(engine.request).toBeUndefined()
  })

  it('rejects a completed workflow with no reserved critic child and denies file tools', async () => {
    const { ctx, request, engine } = await noChildSetup()
    for (const name of ['conductor-devils-advocate', 'conductor-specialist']) {
      ctx.skills.register({ name, description: name, content: 'producer', source: 'test',
        metadata: { analysisCritic: { dispatchMode: 'critic', instructions: 'critic' } } })
    }
    await expect(dispatchAnalysisChild(request)).rejects.toThrow('without a reserved child id')
    expect(engine.request?.maxOutputTokensPerChild).toBe(32)
    expect(engine.request?.composeChildPrompt).toBeTypeOf('function')
    const guard = engine.request?.childToolGuard
    expect(guard).toBeTypeOf('function')
    expect(guard?.({ name: 'read' } as Parameters<NonNullable<typeof guard>>[0])).toMatch(/only admitted excerpts/)
    expect(guard?.({ name: 'structured_output' } as Parameters<NonNullable<typeof guard>>[0])).toBeUndefined()
  })
})
