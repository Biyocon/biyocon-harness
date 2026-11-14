/** Typed producer and critic dispatch over the same real child workflow. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { buildCriticInput, reportHash, reportProducer, validateAnalysisChallenge } from '@deepseek-ai/dsh-conductor'
import type {
  AnalysisChallengeContext, CapturedChallengeIdentity, ConductorMaterialId, ConductorRun, ConductorStage, ReportCandidate,
} from '@deepseek-ai/dsh-conductor'
import { ROLE_SKILL } from '@deepseek-ai/dsh-conductor-presets'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import type { ToolGuard } from '@deepseek-ai/dsh-tools'
import { ANALYSIS_CHALLENGE_OUTPUT_SCHEMA, ANALYSIS_SCHEMA } from './analysis-schema.ts'
import { runWorkflowChild } from './workflow-child.ts'

interface CommonDispatch {
  ctx: Context
  providerName: string
  parent: Agent
  signal: AbortSignal
  run: ConductorRun
}

/** The current producer path retains its existing prompt, persona and policy. */
interface ProducerDispatch extends CommonDispatch {
  mode: 'producer'
  stage: ConductorStage
  prompt: string
  persona: string
  childToolContribution?: SubagentChildToolContribution
  childToolGuard?: ToolGuard
}

/** Host-owned facts and validated limits for one prepared critic attempt. */
interface CriticDispatch extends CommonDispatch {
  mode: 'critic'
  candidate: ReportCandidate
  producerChildId: string
  criticAttempt: number
  materialSpans: unknown
  previous: readonly CapturedChallengeIdentity[]
  maxInputTokens: number
  maxOutputTokens: number
  maxSummaryCharacters: number
  countTokens: (prompt: string) => number
  onReservedChildId?: (id: SessionId) => void
  onPromptTokens?: (tokens: number) => void
  onRawResult?: (value: unknown) => void
}

type AnalysisDispatch = ProducerDispatch | CriticDispatch

const CRITIC_RESULT_INSTRUCTION = 'Return one AnalysisChallenge for the supplied identity and admitted excerpts.'

function criticInstructions(skill: { metadata?: Readonly<Record<string, unknown>> } | undefined, name: string): string {
  const value = skill?.metadata?.analysisCritic
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Conductor required skill "${name}" lacks analysis critic instructions`)
  }
  const critic = value as Record<string, unknown>
  if (critic.dispatchMode !== 'critic' || typeof critic.instructions !== 'string' || !critic.instructions.trim()) {
    throw new Error(`Conductor required skill "${name}" has invalid analysis critic instructions`)
  }
  return critic.instructions
}

/**
 * Dispatch an analysis producer or a prepared critic over the same workflow stack.
 * The critic binds its prompt to the reserved child id and classifies the returned challenge
 * before any later gate can consume it.
 * @param request - selected typed mode, admitted run and host-owned dispatch facts.
 * @returns producer envelope or classified, candidate-bound critic result.
 */
export async function dispatchAnalysisChild(request: AnalysisDispatch): Promise<unknown> {
  const { ctx, providerName, parent, signal, run } = request
  if (run.admission.purpose !== 'analysis') throw new Error('Conductor analysis dispatch requires an analysis run')
  if (request.mode === 'producer') {
    const policy = {
      ...request.childToolGuard === undefined ? {} : { childToolGuard: request.childToolGuard },
    }
    return await runWorkflowChild(ctx, providerName, parent, signal, request.stage, run,
      request.prompt, ANALYSIS_SCHEMA, request.persona, request.childToolContribution,
      request.stage === reportProducer(run.admission) ? { ...policy, analysisMode: 'producer' } : policy)
  }
  const criticRoleName = ROLE_SKILL['devils-advocate']
  /* v8 ignore next -- the preset's fixed ROLE_SKILL mapping declares the critic role. */
  if (criticRoleName === undefined) throw new Error('Conductor critic role skill mapping is unavailable')
  const names = [criticRoleName, 'conductor-specialist'] as const
  const [roleSkill, specialistSkill] = await Promise.all(names.map(name => ctx.skills.get(name, {
    scope: parent, cwd: parent.session.header.cwd, signal,
  })))
  const persona = [criticInstructions(roleSkill, names[0]), criticInstructions(specialistSkill, names[1])].join('\n\n')
  const candidateHash = reportHash(request.candidate)
  let criticChildId: SessionId | undefined
  const value = await runWorkflowChild(ctx, providerName, parent, signal, 'devils-advocate', run,
    'Conductor analysis critic', ANALYSIS_CHALLENGE_OUTPUT_SCHEMA, persona, undefined, {
      childToolFilter: { allow: [] },
      childToolGuard: exec => exec.name === 'structured_output' ? undefined : 'Conductor critic uses only admitted excerpts.',
      maxOutputTokensPerChild: request.maxOutputTokens,
      analysisMode: 'critic',
      criticAttempt: request.criticAttempt,
      composeChildPrompt: (id) => {
        criticChildId = id
        request.onReservedChildId?.(id)
        const input = buildCriticInput({
          candidate: request.candidate,
          identity: {
            run_id: run.runId,
            candidate_hash: candidateHash,
            candidate_version: request.candidate.version,
            critic_child_id: id,
            critic_attempt: request.criticAttempt,
            material_ids: request.candidate.material_ids as ConductorMaterialId[],
          },
          acceptanceCriteria: run.acceptanceCriteria,
          materials: run.admission.materials,
          materialSpans: request.materialSpans,
          instructionText: CRITIC_RESULT_INSTRUCTION,
          maxTokens: request.maxInputTokens,
          countTokens: prompt => request.countTokens(`${persona}\n\n${prompt}`),
        })
        request.onPromptTokens?.(input.tokenCount)
        return [{ type: 'text', text: input.prompt }]
      },
    })
  if (criticChildId === undefined) throw new Error('Conductor critic workflow completed without a reserved child id')
  request.onRawResult?.(value)
  const context: AnalysisChallengeContext = {
    runId: run.runId,
    candidateHash,
    candidateVersion: request.candidate.version,
    materialIds: request.candidate.material_ids as ConductorMaterialId[],
    criticChildId,
    producerChildId: request.producerChildId,
    criticAttempt: request.criticAttempt,
    dispatchMode: 'critic',
    entry: run.admission.entry,
    deliverable: run.admission.deliverable,
    producer: reportProducer(run.admission),
    maxSummaryCharacters: request.maxSummaryCharacters,
    previous: request.previous,
  }
  return validateAnalysisChallenge(value, context)
}
