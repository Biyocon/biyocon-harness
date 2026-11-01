/**
 * Host-only projection and response encoding for the typed owner card.
 * @module @deepseek-ai/dsh-tool-conductor/owner-presentation
 */
import { effectiveOwnerMandate, ownerCommandAllowed, ownerMandateHash, pendingOwnerQuestion } from '@deepseek-ai/dsh-conductor'
import type { ConductorRun, OwnerTransportBinding, ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import type { AskUserQuestionAnswer, ConductorOwnerIntent } from '@deepseek-ai/dsh-user-questions'

/**
 * Project a current, durably parked question without exposing a continuation capability.
 * @param run - authoritative run loaded by its owning controller.
 * @returns exact metadata and any host-validated authority preview.
 */
export function ownerQuestionIntent(run: ConductorRun): ConductorOwnerIntent {
  const pending = pendingOwnerQuestion(run)
  const last = run.ownerLedger.at(-1)
  const recorded = run.status === 'continuation_pending' && last?.kind === 'answer'
    ? run.ownerLedger.find(entry => entry.kind === 'question' && entry.question.id === last.questionId) : undefined
  const question = pending ?? (recorded?.kind === 'question' ? recorded.question : undefined)
  if (question === undefined) throw new Error('Conductor has no pending owner question to present')
  const gate = run.history[question.gateIndex]
  if (gate === undefined) throw new Error('Conductor owner question has no originating gate')
  if (question.stage === 'intake' || question.stage === 'ralph' || question.stage === 'closeout' || question.stage === 'report-complete') {
    throw new Error('Conductor owner question requires one of the seven gated specialist roles')
  }
  const before = effectiveOwnerMandate(run)
  before.qualityCommandIds = (run.ownerCapabilities?.qualityCommandIds ?? []).filter(id => ownerCommandAllowed(run, id))
  return { kind: 'conductor-owner', ...(pending === undefined ? { mode: 'continuation' as const } : {}), runId: run.runId, questionId: question.id, revision: run.ownerRevision,
    gate: gate.gate, role: question.stage, attempt: question.attempt, reason: question.reason,
    items: structuredClone(question.items), ...pending === undefined || question.proposal === undefined ? {} : {
      proposal: { before, after: structuredClone(question.proposal),
        hash: ownerMandateHash(question.proposal) },
    } }
}

/**
 * Bind machine actions to the controller's current transport, never a client-supplied root.
 * @param binding - private host-issued transport identity.
 * @param answer - typed UI response; ledger validation checks every required answer and proposal.
 * @returns host-authored response for the P2 reservation and durability path.
 */
export function ownerQuestionResponse(binding: OwnerTransportBinding, answer: AskUserQuestionAnswer): ScriptedOwnerResponse {
  const value = answer.conductor
  if (value === undefined || answer.answers.length !== 0 || value.questionId !== binding.questionId
    || value.revision !== binding.revision) throw new Error('Conductor owner response does not match the current question and revision')
  return { source: 'host-ui', rootSessionId: binding.rootSessionId, questionId: binding.questionId,
    expectedRevision: binding.revision, action: value.action, answers: structuredClone(value.answers),
    ...value.proposalHash === undefined ? {} : { proposalHash: value.proposalHash } }
}
