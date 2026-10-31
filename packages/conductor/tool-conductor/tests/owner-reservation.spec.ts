import { describe, expect, it } from 'vitest'
import { admitIntake, captureIntakeMaterial, ConductorRunId, contentHash, createRun,
  applyScriptedOwnerAnswer, parkOwnerQuestion, recordGate } from '@deepseek-ai/dsh-conductor'
import type { ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import { SessionId } from '@deepseek-ai/dsh-session'
import { OwnerReservations } from '../src/owner-reservation.ts'

function parked() {
  const root = SessionId('owner-reservation-root')
  const material = captureIntakeMaterial('current-request', 'Assess the evidence.', { sessionId: root, eventIndex: 0 })
  const run = recordGate(createRun(ConductorRunId('CON-2026-0037'), {
    objective: 'Assess the evidence.', ownerSessionId: root, authority: { owner: 'owner' },
    ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: [] },
    acceptanceCriteria: ['Answer the question.'],
    admission: admitIntake({ purpose: 'analysis', entry: 'detective', deliverable: 'answer', rationale: 'New question.' }, [material]),
  }), { decision: 'escalate', basis: ['Clarification needed.'], evidenceReviewed: [], stateUpdate: 'Await owner.' })
  return parkOwnerQuestion(run, 'owner-question', { kind: 'recoverable', cause: 'clarification', reason: 'Which evidence?' },
    { childId: SessionId('owner-reservation-child'), attempt: 1, report: {}, reportHash: contentHash('{}') },
    [{ id: 'evidence', prompt: 'Which evidence?', options: [] }])
}

function answer(run = parked()): ScriptedOwnerResponse {
  return { source: 'scripted-test-provider', rootSessionId: run.ownerSessionId!, questionId: 'owner-question',
    expectedRevision: run.ownerRevision, action: 'answer_continue', answers: [{ itemId: 'evidence', text: 'Use the cited file.' }] }
}

describe('exact process-owned owner reservations', () => {
  it('reserves without mutating durable state and acknowledges only the exact saved checkpoint', () => {
    const run = parked()
    const host = new OwnerReservations()
    const binding = host.reconnect(run)
    const reservation = host.reserve(run, binding, answer(run))
    expect(run.status).toBe('awaiting_owner')
    expect(host.validate(reservation, run)).toEqual(reservation.proposed)
    expect(() => host.acknowledge(reservation, run)).toThrow('exact checkpoint')
    expect(host.acknowledge(reservation, reservation.proposed)).toEqual({
      runId: run.runId, questionId: 'owner-question', revision: run.ownerRevision + 1, status: 'continuation_pending',
    })
    expect(() => host.validate(reservation, run)).toThrow('already consumed')
  })

  it('does not accept a copied reservation or an already reserved response', () => {
    const run = parked()
    const host = new OwnerReservations()
    const binding = host.reconnect(run)
    const reservation = host.reserve(run, binding, answer(run))
    expect(() => host.reserve(run, binding, answer(run))).toThrow('already has')
    expect(() => host.reconnect(run)).toThrow('already reserved')
    expect(() => host.validate({ ...reservation }, run)).toThrow('forged')
    expect(() => host.acknowledge({ ...reservation }, reservation.proposed)).toThrow('exact checkpoint')
    host.cancel()
    expect(() => host.validate(reservation, run)).toThrow('stale')
  })

  it('rejects foreign or stale transport, run, session, question and revision bindings', () => {
    const run = parked()
    const host = new OwnerReservations()
    expect(() => host.reserve(run, { runId: run.runId, questionId: 'owner-question', rootSessionId: run.ownerSessionId!,
      revision: 1, transportId: 'invented' }, answer(run))).toThrow('transport binding')
    const old = host.reconnect(run)
    const binding = host.reconnect(run)
    expect(binding.questionId).toBe(old.questionId)
    expect(binding.transportId).not.toBe(old.transportId)
    for (const changed of [{ transportId: old.transportId }, { runId: ConductorRunId('CON-2026-0038') },
      { questionId: 'other' }, { rootSessionId: SessionId('foreign') }, { revision: 0 }]) {
      expect(() => host.reserve(run, { ...binding, ...changed }, answer(run))).toThrow('transport binding')
    }
    for (const changed of [{ rootSessionId: SessionId('foreign') }, { questionId: 'other' }, { expectedRevision: 0 }]) {
      expect(() => host.reserve(run, binding, { ...answer(run), ...changed })).toThrow('transport binding')
    }
  })

  it('loses uncommitted authority on restart, retaining the pending durable question', () => {
    const run = parked()
    const host = new OwnerReservations()
    const reservation = host.reserve(run, host.reconnect(run), answer(run))
    const restarted = new OwnerReservations()
    expect(() => restarted.validate(reservation, run)).toThrow('stale')
    expect(restarted.reconnect(run).questionId).toBe('owner-question')
    expect(() => restarted.reconnect({ ...run, status: 'aborted' })).toThrow('no pending')
    expect(() => restarted.reconnect({ ...run, ownerSessionId: null })).toThrow('no pending')
  })

  it('keeps rejection terminal and rejects changed authoritative records before consumption', () => {
    const run = parked()
    const host = new OwnerReservations()
    const reservation = host.reserve(run, host.reconnect(run), { ...answer(run), action: 'reject', answers: [] })
    expect(reservation.proposed.status).toBe('aborted')
    for (const changed of [{ runId: ConductorRunId('CON-2026-0038') }, { ownerRevision: 0 }, { ownerSessionId: SessionId('foreign') }]) {
      expect(() => host.validate(reservation, { ...run, ...changed })).toThrow('stale')
    }
    expect(host.acknowledge(reservation, reservation.proposed).status).toBe('aborted')
  })
})


describe('saved-answer continuation reservations', () => {
  it('binds one saved plan to a fresh transport and never charges another answer', () => {
    const pending = parked()
    const run = applyScriptedOwnerAnswer(pending, answer(pending))
    const host = new OwnerReservations()
    expect(() => host.reconnectContinuation(pending)).toThrow('no saved owner continuation')
    expect(() => host.reconnectContinuation({ ...run, ownerLedger: [] })).toThrow('no saved owner continuation')
    expect(() => host.reconnectContinuation({ ...run, ownerSessionId: null })).toThrow('no saved owner continuation')
    const binding = host.reconnectContinuation(run)
    for (const patch of [{ runId: ConductorRunId('CON-2026-0038') }, { rootSessionId: SessionId('foreign') },
      { questionId: 'foreign' }, { revision: 0 }, { transportId: 'forged' }]) {
      expect(() =>{  host.consumeContinuation(run, { ...binding, ...patch }) }).toThrow('foreign, stale or consumed')
    }
    for (const altered of [{ ...run, runId: ConductorRunId('CON-2026-0038') }, { ...run, ownerSessionId: SessionId('foreign') },
      { ...run, ownerRevision: run.ownerRevision + 1 }, pending, { ...run, ownerLedger: [] }]) {
      expect(() =>{  host.consumeContinuation(altered, binding) }).toThrow('foreign, stale or consumed')
    }
    host.consumeContinuation(run, binding)
    expect(run.ownerLedger).toHaveLength(2)
    expect(() =>{  host.consumeContinuation(run, binding) }).toThrow('consumed')
    const another = new OwnerReservations()
    const request = another.reconnect(pending)
    another.reserve(pending, request, answer(pending))
    expect(() => another.reconnectContinuation(run)).toThrow('already reserved')
  })
})
