/** P1 parking and scripted test responses; no live answer controller or routing hook. */
import type { Context } from '@deepseek-ai/cordis'
import {
  applyScriptedOwnerAnswer, consumeOwnerContinuation, contentHash, parkOwnerQuestion,
  pendingOwnerQuestion, ownerReassessments,
} from '@deepseek-ai/dsh-conductor'
import type {
  AnalysisEnvelope, ConductorOutcome, ConductorRun, OwnerMandate, OwnerQuestion,
  OwnerQuestionItem, OwnerQuestionSource, ScriptedOwnerResponse, SpecialistEnvelope,
} from '@deepseek-ai/dsh-conductor'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { canonicalAbsolute, containsPath } from './path-policy.ts'

/** Explicit test-only dependency. The shipped preset mounts no answer provider. */
export interface ConductorOwnerTestProvider {
  kind: 'scripted-test-provider'
  answer(run: ConductorRun, question: OwnerQuestion): Promise<ScriptedOwnerResponse | null>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    conductorOwnerTestProvider?: ConductorOwnerTestProvider
  }
}

/** Host observation from the exact completed workflow, never model-supplied identity. */
export interface OwnerDispatchObservation {
  historyOffset: number
  childId: SessionId
  attempt: number
  report: unknown
}

function questionMaterial(
  run: ConductorRun, source: OwnerQuestionSource, exhausted: boolean,
): { items: OwnerQuestionItem[]; proposal?: OwnerMandate } {
  if (exhausted) return { items: [{ id: 'reassessment', prompt: 'Provide corrected evidence for this gate reassessment.', options: [] }] }
  if (run.admission.purpose === 'analysis') {
    const report = (typeof source.report === 'object' && source.report !== null ? source.report : {}) as Partial<AnalysisEnvelope>
    return { items: report.clarifications ?? [{ id: 'reassessment', prompt: 'Provide corrected evidence for this read-only reassessment.', options: [] }] }
  }
  const report = (typeof source.report === 'object' && source.report !== null ? source.report : {}) as Partial<SpecialistEnvelope>
  const requests = Array.isArray(report.change_requests) && (report.change_requests as unknown[]).every(request =>
    typeof request === 'object' && request !== null && 'reason' in request && typeof request.reason === 'string') ? report.change_requests : []
  const proposals = requests.flatMap(request => request.proposal === undefined ? [] : [request.proposal])
  if (proposals.length > 1) throw new Error('Conductor owner question requires one exact host-validated mandate proposal')
  return { items: requests.length === 0
    ? [{ id: 'reassessment', prompt: 'Provide corrected evidence for this gate reassessment.', options: [] }]
    : requests.map((request, index) => ({ id: `request-${index + 1}`, prompt: request.reason, options: [] })),
  ...proposals[0] === undefined ? {} : { proposal: proposals[0] } }
}

/**
 * Park an explicitly recoverable outcome and optionally exercise scripted host answers.
 * Every ledger transition is flushed before test continuation. Without the test dependency,
 * the run stays parked and no authorization or subsequent dispatch is possible.
 * @param ctx - optional scripted test-provider context.
 * @param outcome - driver result with an explicit runtime classification.
 * @param observation - host-captured child and raw report for the last gate.
 * @param cwd - admitted workspace for canonical proposal validation.
 * @param save - authoritative flushed checkpoint writer.
 * @returns parked/terminal outcome, or a single consumed test continuation.
 */
export async function settleOwnerEscalation(
  ctx: Context, outcome: ConductorOutcome, observation: OwnerDispatchObservation | undefined,
  cwd: string, save: (run: ConductorRun) => Promise<void>,
): Promise<{ outcome: ConductorOutcome; continuation?: ConductorRun }> {
  if (outcome.kind !== 'blocked' || outcome.ownerEscalation?.kind !== 'recoverable'
    || observation === undefined || observation.historyOffset !== outcome.run.history.length - 1) return { outcome }
  const gate = outcome.run.history.at(-1)?.gate
  if (gate === undefined) throw new Error('Conductor owner escalation requires a recorded gate')
  const count = ownerReassessments(outcome.run, gate)
  const limit = outcome.run.budget.maxOwnerReassessmentsPerGate
  if (count >= limit) return { outcome: { kind: 'blocked', run: outcome.run,
    blocker: `Conductor ${outcome.run.runId} gate ${gate} exhausted ${count}/${limit} owner reassessments: ${outcome.ownerEscalation.reason}` } }
  const source: OwnerQuestionSource = { childId: observation.childId, attempt: observation.attempt,
    report: observation.report, reportHash: contentHash(JSON.stringify(observation.report)) }
  const material = questionMaterial(outcome.run, source, outcome.ownerEscalation.cause === 'rework-exhausted')
  if (material.proposal !== undefined) {
    const workspace = canonicalAbsolute(cwd, cwd)
    if ([...material.proposal.allowedPaths, ...material.proposal.excludedPaths]
      .some(path => !containsPath(workspace, canonicalAbsolute(cwd, path)))) {
      throw new Error('Conductor owner mandate proposal escapes the workspace through a path or symlink')
    }
  }
  const id = `${outcome.run.runId}:owner:${outcome.run.ownerRevision + 1}`
  let run = parkOwnerQuestion(outcome.run, id, outcome.ownerEscalation, source, material.items, material.proposal)
  await save(run)
  const question = pendingOwnerQuestion(run)
  if (question === undefined) throw new Error('Conductor owner question disappeared before the scripted response')
  const provider: { kind: unknown; answer: ConductorOwnerTestProvider['answer'] } | undefined = ctx.get('conductorOwnerTestProvider')
  if (provider !== undefined && provider.kind !== 'scripted-test-provider') throw new Error('Conductor P1 accepts only scripted test-provider responses')
  const response = provider === undefined ? null : await provider.answer(run, question)
  if (response === null) {
    return { outcome: { kind: 'blocked', blocker: 'Conductor is awaiting owner input; P1 has no production answer provider.', run } }
  } else {
    run = applyScriptedOwnerAnswer(run, response)
    await save(run)
    if (run.status === 'aborted') return { outcome: { kind: 'blocked', blocker: 'Conductor owner rejected the question; no continuation was dispatched.', run } }
    run = consumeOwnerContinuation(run, question.id)
    await save(run)
    return { outcome: { ...outcome, run }, continuation: run }
  }
}
