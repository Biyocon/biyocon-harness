import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { applyScriptedOwnerAnswer, admitIntake, captureIntakeMaterial, ConductorRunId, contentHash, createRun, parkOwnerQuestion, recordGate } from '@deepseek-ai/dsh-conductor'
import type { OwnerTransportBinding } from '@deepseek-ai/dsh-conductor'
import { ownerQuestionIntent, ownerQuestionResponse } from '../src/owner-presentation.ts'

function run(proposal = false) {
  const material = captureIntakeMaterial('current-request', 'Assess the evidence.', { sessionId: SessionId('root'), eventIndex: 0 })
  const initial = recordGate(createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: SessionId('root'), ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: ['unit'] },
    objective: 'Assess the evidence.', authority: { owner: 'owner' }, acceptanceCriteria: ['Cite evidence.'],
    admission: admitIntake({ purpose: 'implementation', entry: 'detective', rationale: 'New task.' }, [material]),
  }), { decision: 'escalate', basis: ['Clarification.'], evidenceReviewed: [], stateUpdate: 'Await owner.' })
  return parkOwnerQuestion(initial, 'question', { kind: 'recoverable', cause: proposal ? 'authority-amendment' : 'clarification', reason: 'Which evidence?' },
    { childId: SessionId('child'), attempt: 1, report: {}, reportHash: contentHash('{}') },
    [{ id: 'evidence', prompt: 'Which evidence?', options: [] }],
    proposal ? { allowedPaths: ['docs'], excludedPaths: [], qualityCommandIds: ['unit'] } : undefined)
}
const binding: OwnerTransportBinding = { rootSessionId: SessionId('root'), runId: ConductorRunId('CON-2026-0037'), questionId: 'question', revision: 1, transportId: 'opaque' }

describe('typed owner question presentation', () => {
  it('preserves provenance, required items and exact before/after authority', () => {
    expect(ownerQuestionIntent(run())).toMatchObject({ kind: 'conductor-owner', runId: binding.runId, questionId: 'question',
      revision: 1, gate: 'A', role: 'detective', attempt: 1, reason: 'Which evidence?', items: [{ id: 'evidence', prompt: 'Which evidence?', options: [] }] })
    const projected = ownerQuestionIntent(run(true))
    expect(projected.proposal).toMatchObject({ before: { allowedPaths: [], excludedPaths: [], qualityCommandIds: ['unit'] },
      after: { allowedPaths: ['docs'], excludedPaths: [], qualityCommandIds: ['unit'] } })
    expect(projected.proposal?.hash).toMatch(/^[a-f0-9]{64}$/)
    const saved = applyScriptedOwnerAnswer(run(true), { source: 'host-ui', rootSessionId: binding.rootSessionId,
      questionId: binding.questionId, expectedRevision: 1, action: 'approve',
      answers: [{ itemId: 'evidence', text: 'Use cited evidence.' }], proposalHash: projected.proposal!.hash })
    expect(ownerQuestionIntent(saved)).toMatchObject({ mode: 'continuation', revision: 2 })
    expect(ownerQuestionIntent(saved).proposal).toBeUndefined()
    expect(() => ownerQuestionIntent({ ...saved, ownerLedger: [] })).toThrow('no pending owner question')
    const legacy = run(); legacy.ownerCapabilities = null
    expect(ownerQuestionIntent(legacy).proposal).toBeUndefined()
    const empty = run(); empty.ownerLedger = []
    expect(() => ownerQuestionIntent(empty)).toThrow('no pending owner question')
    const noGate = run(); noGate.history = []
    expect(() => ownerQuestionIntent(noGate)).toThrow('no originating gate')
    const intake = run(); const entry = intake.ownerLedger[0]
    if (entry?.kind !== 'question') throw new Error('Missing fixture question')
    for (const stage of ['intake', 'ralph', 'closeout', 'report-complete'] as const) {
      entry.question.stage = stage
      expect(() => ownerQuestionIntent(intake)).toThrow('seven gated specialist roles')
    }
  })

  it('binds actions to host identity, never client authority or translated labels', () => {
    const conductor = { questionId: 'question', revision: 1, action: 'answer_continue' as const,
      answers: [{ itemId: 'evidence', text: 'Use cited evidence.' }] }
    expect(ownerQuestionResponse(binding, { answers: [], conductor })).toEqual({ source: 'host-ui', rootSessionId: 'root',
      questionId: 'question', expectedRevision: 1, action: 'answer_continue', answers: conductor.answers })
    expect(ownerQuestionResponse(binding, { answers: [], conductor: { ...conductor, proposalHash: 'hash' } }).proposalHash).toBe('hash')
    for (const answer of [{ answers: [] }, { answers: [{ id: 'other', selected: [] }], conductor },
      { answers: [], conductor: { ...conductor, questionId: 'foreign' } }, { answers: [], conductor: { ...conductor, revision: 0 } }]) {
      expect(() => ownerQuestionResponse(binding, answer)).toThrow('current question and revision')
    }
  })
})
