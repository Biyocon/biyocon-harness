import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  admitIntake, captureIntakeMaterial, ConductorRunId, createRun, ownerMandateHash, recordGate,
} from '@deepseek-ai/dsh-conductor'
import type { ConductorOutcome, ConductorRun, OwnerQuestion, ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import { SessionId } from '@deepseek-ai/dsh-session'
import { settleOwnerEscalation } from '../src/owner-interaction.ts'
import type { ConductorOwnerTestProvider, OwnerDispatchObservation } from '../src/owner-interaction.ts'

const root = SessionId('owner-parent')
const cause = { kind: 'recoverable', cause: 'clarification', reason: 'Which evidence should be assessed?' } as const
const proposal = { allowedPaths: ['report.md'], excludedPaths: [], qualityCommandIds: [] }

function initial(analysis = false): ConductorRun {
  const material = captureIntakeMaterial('current-request', 'Assess the documentation.', { sessionId: root, eventIndex: 0 })
  return recordGate(createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: root, ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: [] },
    objective: 'Assess the documentation.', authority: { owner: 'owner' }, acceptanceCriteria: ['Assess cited evidence.'],
    admission: admitIntake({ purpose: analysis ? 'analysis' : 'implementation', entry: 'detective',
      ...analysis ? { deliverable: 'answer' } : {}, rationale: 'New owner request.' }, [material]),
  }), { decision: 'escalate', basis: [cause.reason], evidenceReviewed: [], stateUpdate: 'owner clarification required' })
}

function blocked(run: ConductorRun): ConductorOutcome {
  return { kind: 'blocked', blocker: cause.reason, ownerEscalation: cause, run }
}

function observed(run: ConductorRun, report: unknown = {}, attempt = 1): OwnerDispatchObservation {
  return { historyOffset: run.history.length - 1, childId: SessionId(`owner-child-${attempt}`), attempt, report }
}

function response(run: ConductorRun, question: OwnerQuestion, reject = false): ScriptedOwnerResponse {
  return { source: 'scripted-test-provider', rootSessionId: root, questionId: question.id,
    expectedRevision: run.ownerRevision, action: reject ? 'reject' : question.proposal === undefined ? 'answer_continue' : 'approve',
    answers: reject ? [] : question.items.map(item => ({ itemId: item.id, text: 'Use the cited evidence.' })),
    ...question.proposal === undefined || reject ? {} : { proposalHash: ownerMandateHash(question.proposal) } }
}

describe('P1 owner parking and the explicit scripted provider', () => {
  it('describes the enabled question card without claiming owner answering is unavailable', async () => {
    const run = initial()
    const result = await settleOwnerEscalation(new Context(), blocked(run), observed(run), process.cwd(), vi.fn(), true, true)
    expect(result.outcome.kind).toBe('blocked')
    if (result.outcome.kind !== 'blocked') throw new Error('Missing blocker')
    expect(result.outcome.blocker).toContain('Answer the owner question to continue this same run')
    expect(result.outcome.blocker).not.toContain('not available')
  })
  it('leaves unrelated, terminal and unattributed outcomes unchanged', async () => {
    const ctx = new Context()
    const run = initial()
    const save = vi.fn()
    for (const [outcome, observation] of [
      [{ kind: 'decision', run, decision: {} } as ConductorOutcome, observed(run)],
      [{ kind: 'blocked', run, blocker: 'security failure' } as ConductorOutcome, observed(run)],
      [{ ...blocked(run), ownerEscalation: { kind: 'terminal', cause: 'identity', reason: 'wrong run' } } as ConductorOutcome, observed(run)],
      [blocked(run), undefined], [blocked(run), { ...observed(run), historyOffset: 5 }],
    ] as const) {
      expect(await settleOwnerEscalation(ctx, outcome, observation, process.cwd(), save)).toEqual({ outcome })
    }
    expect(save).not.toHaveBeenCalled()
  })

  it('requires a recorded gate and rechecks the pending question after the checkpoint callback', async () => {
    const ctx = new Context()
    const run = initial()
    const missingGate = { ...run, history: [] }
    await expect(settleOwnerEscalation(ctx, blocked(missingGate), observed(missingGate), process.cwd(), () => Promise.resolve()))
      .rejects.toThrow('requires a recorded gate')
    const answer = vi.fn()
    ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer })
    await expect(settleOwnerEscalation(ctx, blocked(run), observed(run), process.cwd(), (checkpoint) => {
      checkpoint.ownerLedger = []; return Promise.resolve()
    })).rejects.toThrow('question disappeared')
    expect(answer).not.toHaveBeenCalled()
  })

  it.each([undefined, null] as const)('parks without granting anything when the provider is %s', async (provider) => {
    const ctx = new Context()
    if (provider === null) ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: () => Promise.resolve(null) })
    const run = initial()
    const saved: ConductorRun[] = []
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run, null), process.cwd(), (value) => {
      saved.push(value); return Promise.resolve()
    })
    expect(result.continuation).toBeUndefined()
    expect(result.outcome.run.status).toBe('awaiting_owner')
    expect(result.outcome.run.executionAuthorization).toBeNull()
    expect(result.outcome.run.ownerLedger.map(entry => entry.kind)).toEqual(['question'])
    expect(saved).toHaveLength(1)
    expect(result.outcome.run.history).toEqual(run.history)
    expect(result.outcome).toMatchObject({ kind: 'blocked',
      blocker: `Conductor is awaiting owner input: ${cause.reason}\n`
        + 'Answering owner questions is not available in this build yet; the run stays parked and grants nothing.' })
  })

  it('flushes question, response/reservation and consumption before returning the exact continuation', async () => {
    const ctx = new Context()
    const statuses: string[] = []
    ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => Promise.resolve(response(run, question)) })
    const run = initial()
    const outcome = { ...blocked(run), ownerEscalation: { ...cause, cause: 'authority-amendment' as const } } as ConductorOutcome
    const result = await settleOwnerEscalation(ctx, outcome, observed(run, { change_requests: [
      { target: 'authority', reason: 'Allow the report path.', impact: 'Report delivery.', proposal },
    ] }), process.cwd(), (value) => { statuses.push(value.status); return Promise.resolve() })
    expect(statuses).toEqual(['awaiting_owner', 'continuation_pending', 'rework'])
    expect(result.continuation?.currentStage).toBe('strategist')
    expect(result.continuation?.baseline).toBeNull()
    expect(result.continuation?.executionAuthorization).toBeNull()
    expect(result.continuation?.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'answer', 'consumed'])
    expect(result.continuation?.admission).toEqual(run.admission)
  })

  it('groups implementation clarification requests without treating answers as an amendment', async () => {
    const ctx = new Context()
    ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => Promise.resolve(response(run, question)) })
    const run = initial()
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run, { change_requests: [
      { target: 'plan', reason: 'Which provider identity is canonical?', impact: 'Choose the correct report scope.' },
    ] }), process.cwd(), () => Promise.resolve())
    expect(result.continuation?.allowedPaths).toEqual(run.allowedPaths)
    expect(result.continuation?.currentStage).toBe('detective')
    expect(result.continuation?.executionAuthorization).toBeNull()
  })

  it('stops on rejection without consuming a plan', async () => {
    const ctx = new Context()
    ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => Promise.resolve(response(run, question, true)) })
    const run = initial()
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run), process.cwd(), () => Promise.resolve())
    expect(result.outcome.run.status).toBe('aborted')
    expect(result.outcome.run.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'rejected'])
    expect(result.continuation).toBeUndefined()
    expect(result.outcome).toMatchObject({ kind: 'blocked',
      blocker: `Conductor owner rejected the question: ${cause.reason}\n`
        + 'The run is aborted; no continuation was dispatched.' })
  })

  it('does not reinterpret malformed model fields when exhausted rework needs owner evidence', async () => {
    const ctx = new Context()
    const run = initial()
    const outcome = { ...blocked(run), ownerEscalation: { ...cause, cause: 'rework-exhausted' as const } } as ConductorOutcome
    const result = await settleOwnerEscalation(ctx, outcome, observed(run, {
      change_requests: [{ reason: 'unvalidated', proposal: 'invalid' }], clarifications: ['invalid'],
    }), process.cwd(), () => Promise.resolve())
    expect(result.outcome.run.ownerLedger[0]).toMatchObject({ kind: 'question', question: {
      items: [{ id: 'reassessment' }], cause: 'rework-exhausted',
    } })
    const entry = result.outcome.run.ownerLedger[0]!
    if (entry.kind !== 'question') throw new Error('expected a parked question')
    expect(entry.question.proposal).toBeUndefined()
  })

  it.each([null, {}, 42, { reason: 42 }])('does not derive authority or question items from malformed host observations: %j', async (request) => {
    const ctx = new Context()
    const run = initial()
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run, { change_requests: [request] }),
      process.cwd(), () => Promise.resolve())
    expect(result.outcome.run.ownerLedger[0]).toMatchObject({ kind: 'question', question: { items: [{ id: 'reassessment' }] } })
  })

  it.each([null, {}, { clarifications: [{ id: 'source', prompt: 'Which read-only source?', options: [] }] }])('uses only read-only analysis questions: %j', async (report) => {
    const ctx = new Context()
    const run = initial(true)
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run, report), process.cwd(), () => Promise.resolve())
    expect(result.outcome.run.status).toBe('awaiting_owner')
    expect(result.outcome.run.baseline).toBeNull()
    expect(result.outcome.run.ownerLedger[0]).toMatchObject({ kind: 'question', question: { stage: 'detective' } })
  })

  it('parks a critic budget stop as a host source without inventing a child attempt', async () => {
    const base = initial(true)
    const first = base.history[0]
    if (first?.kind !== 'evaluated') throw new Error('Expected an evaluated gate')
    const material = base.admission.materials[0]
    const run: ConductorRun = { ...base, currentStage: 'devils-advocate', analysisMode: 'critic',
      history: [{ ...first, decision: 'pass', analysis: { mode: 'producer',
        candidateHash: 'a'.repeat(64), childId: SessionId('producer-child') } },
      { ...first, gate: 'C', stage: 'devils-advocate', origin: 'critic-budget',
        basis: ['critic token budget exhausted'], stateUpdate: 'critic blocked: critic token budget exhausted' }],
      reportCandidates: [{ producer: 'detective', producerChildId: SessionId('producer-child'),
        hash: 'a'.repeat(64), candidate: { version: 'v1', deliverable: 'answer', content: 'Read-only answer.',
          criteria: [{ criterion: 'Assess cited evidence.', outcome: 'Assessed.' }],
          material_ids: [material.id], material_spans: [{ material_id: material.id, start_line: 1, end_line: 1 }],
          assumptions: [], limitations: [] } }] }
    const outcome: ConductorOutcome = { kind: 'blocked', blocker: 'critic token budget exhausted', run,
      ownerEscalation: { kind: 'recoverable', cause: 'rework-exhausted', reason: 'critic token budget exhausted' } }
    const settled = await settleOwnerEscalation(new Context(), outcome, observed(run), process.cwd(),
      () => Promise.resolve())
    expect(settled.outcome.run.ownerLedger[0]).toMatchObject({ kind: 'question', question: {
      sourceKind: 'host', childId: null, attempt: null,
      report: { kind: 'critic-budget', candidateHash: 'a'.repeat(64), reason: 'critic token budget exhausted' },
    } })
  })

  it('refuses multiple proposals, workspace escapes and a non-test provider', async () => {
    const run = initial()
    const ctx = new Context()
    const save = vi.fn(() => Promise.resolve())
    const request = { target: 'authority', reason: 'Allow report path.', impact: 'Delivery.', proposal }
    const outcome = { ...blocked(run), ownerEscalation: { ...cause, cause: 'authority-amendment' as const } } as ConductorOutcome
    await expect(settleOwnerEscalation(ctx, outcome, observed(run, { change_requests: [request, request] }), process.cwd(), save)).rejects.toThrow('one exact')
    const cwd = await mkdtemp(join(tmpdir(), 'conductor-owner-path-'))
    try {
      await expect(settleOwnerEscalation(ctx, outcome, observed(run, { change_requests: [{ ...request,
        proposal: { ...proposal, allowedPaths: ['../escape.md'] } }] }), cwd, save)).rejects.toThrow('escapes the workspace')
    } finally { await rm(cwd, { recursive: true, force: true }) }
    const answer = vi.fn()
    ctx.provide('conductorOwnerTestProvider', { kind: 'live', answer } as unknown as ConductorOwnerTestProvider)
    await expect(settleOwnerEscalation(ctx, blocked(run), observed(run, { change_requests: 'invalid' }), process.cwd(), save)).rejects.toThrow('only scripted')
    expect(answer).not.toHaveBeenCalled()
  })

  it('makes a third owner reassessment terminal while preserving both prior reservations', async () => {
    const ctx = new Context()
    ctx.provide('conductorOwnerTestProvider', { kind: 'scripted-test-provider', answer: (run, question) => Promise.resolve(response(run, question)) })
    let run = initial()
    for (let attempt = 1; attempt <= 2; attempt++) {
      const settled = await settleOwnerEscalation(ctx, blocked(run), observed(run, {}, attempt), process.cwd(), () => Promise.resolve())
      run = recordGate(settled.continuation!, { decision: 'escalate', basis: ['New unresolved evidence.'], evidenceReviewed: [], stateUpdate: 'owner input remains necessary' })
    }
    const result = await settleOwnerEscalation(ctx, blocked(run), observed(run, {}, 3), process.cwd(), () => Promise.resolve())
    expect(result.outcome).toMatchObject({ kind: 'blocked', blocker: expect.stringContaining('gate A exhausted 2/2') as unknown })
    expect(result.outcome.run.status).toBe('escalated')
    expect(result.outcome.run.ownerLedger.filter(entry => entry.kind === 'question')).toHaveLength(2)
    expect(result.continuation).toBeUndefined()
  })
})
