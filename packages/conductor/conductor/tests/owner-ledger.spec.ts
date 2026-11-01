import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { contentHash } from '../src/intake.ts'
import { implementationAdmission, analysisRun } from './intake-fixtures.ts'
import { ConductorRunId, createRun, recordGate } from '../src/index.ts'
import { applyScriptedOwnerAnswer, assertOwnerLedger, consumeOwnerContinuation, effectiveOwnerMandate, ownerCommandAllowed, ownerContinuationAt, ownerEscalationForProblem, ownerLifecycleStatus, ownerMandateHash, ownerReassessments, parkOwnerQuestion, pendingOwnerQuestion, pendingOwnerResumePlan } from '../src/owner-ledger.ts'
import type { ConductorRun, ExecutionBaseline } from '../src/types.ts'
import type { OwnerInteraction, OwnerMandate, ScriptedOwnerResponse } from '../src/owner-types.ts'

const root = SessionId('root-owner-session')
const report = { status: 'blocked', summary: 'Which schema is canonical?' }
const source = { childId: SessionId('detective-attempt-1'), attempt: 1, report, reportHash: contentHash(JSON.stringify(report)) }
const items = [{ id: 'schema', prompt: 'Choose the canonical schema.', options: ['v1', 'v2'] }]
const reason = { kind: 'recoverable' as const, cause: 'clarification' as const, reason: 'The scope requires an owner decision.' }
const caps: OwnerMandate = { allowedPaths: ['.'], excludedPaths: ['secrets'], qualityCommandIds: ['unit'] }
const proposal: OwnerMandate = { allowedPaths: ['src', 'docs'], excludedPaths: ['secrets'], qualityCommandIds: ['unit'] }

function blocked(overrides: Partial<ConductorRun> = {}): ConductorRun {
  const initial = createRun(ConductorRunId('CON-2026-0037'), { admission: implementationAdmission(), objective: 'Ship the requested change.',
    authority: { owner: 'owner' }, ownerSessionId: root, ownerCapabilities: caps, allowedPaths: ['src'], excludedPaths: ['secrets'] })
  return recordGate({ ...initial, ...overrides }, { decision: 'escalate', basis: ['Owner input required.'], evidenceReviewed: ['report'], stateUpdate: 'Await owner input.' })
}

function parked(run = blocked()): ConductorRun {
  return parkOwnerQuestion(run, 'question-1', reason, source, items)
}

function response(run: ConductorRun, changes: Partial<ScriptedOwnerResponse> = {}): ScriptedOwnerResponse {
  return { source: 'scripted-test-provider', rootSessionId: root, questionId: 'question-1', expectedRevision: run.ownerRevision,
    action: 'answer_continue', answers: [{ itemId: 'schema', text: 'Use schema v2.', optionId: 'v2' }], ...changes }
}

function answered(run = parked()): ConductorRun { return applyScriptedOwnerAnswer(run, response(run)) }

function clone(run: ConductorRun): ConductorRun { return structuredClone(run) }
function question(run: ConductorRun) { return (run.ownerLedger[0] as Extract<OwnerInteraction, { kind: 'question' }>).question }
function invalid(run: ConductorRun, change: (run: ConductorRun) => void, message: string) {
  const altered = clone(run)
  change(altered)
  expect(() =>{  assertOwnerLedger(altered) }).toThrow(message)
}

describe('durable Conductor owner interactions', () => {
  it('accepts a host UI answer through the same exact ledger validation', () => {
    const run = parked()
    expect(applyScriptedOwnerAnswer(run, response(run, { source: 'host-ui' })).status).toBe('continuation_pending')
  })

  it('classifies exhausted structural repairs without allowing owner answers to waive authority violations', () => {
    expect(ownerEscalationForProblem({ kind: 'report', message: 'Missing required report fields.' })).toEqual({
      kind: 'recoverable', cause: 'rework-exhausted', reason: 'Missing required report fields.',
    })
    expect(ownerEscalationForProblem({ kind: 'authority', message: 'Sandbox boundary violated.' })).toBeUndefined()
  })

  it('captures genuine host session and immutable capabilities with independently validated limits', () => {
    const run = blocked()
    expect(run).toMatchObject({ recordFormatVersion: 4, ownerSessionId: root, ownerRevision: 0, ownerLedger: [], ownerCapabilities: caps })
    expect(run.ownerCapabilities).not.toBe(caps)
    expect(run.budget.maxOwnerReassessmentsPerGate).toBe(2)
    expect(() =>{  assertOwnerLedger(run) }).not.toThrow()
    for (const maxOwnerReassessmentsPerGate of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => createRun(run.runId, { admission: run.admission, objective: run.objective, authority: run.authority,
        budget: { maxReworkPerGate: 2, maxRalphRounds: 0, maxOwnerReassessmentsPerGate } })).toThrow('positive safe integer')
    }
    const explicit = createRun(run.runId, { admission: run.admission, objective: run.objective, authority: run.authority,
      budget: { maxReworkPerGate: 1, maxRalphRounds: 3, maxOwnerReassessmentsPerGate: 1 } })
    expect(explicit.budget).toEqual({ maxReworkPerGate: 1, maxRalphRounds: 3, maxOwnerReassessmentsPerGate: 1 })
  })

  it('parks without a provider and binds the question to one child and gate without changing history', () => {
    const before = blocked()
    const run = parked(before)
    expect(run.history).toBe(before.history)
    expect(run.ownerRevision).toBe(1)
    expect(pendingOwnerQuestion(run)).toMatchObject({ runId: run.runId, rootSessionId: root, childId: source.childId, attempt: 1,
      gateIndex: 0, historyLength: 1, reportHash: source.reportHash, mandateRevision: 0, baselineHash: null })
    expect(ownerLifecycleStatus(run)).toBe('awaiting_owner')
    expect(pendingOwnerQuestion(run)!.report).not.toBe(report)
    expect(pendingOwnerResumePlan(run)).toBeUndefined()
    expect(ownerReassessments(run, 'A')).toBe(0)
    expect(() => recordGate(run, { decision: 'pass', basis: [], evidenceReviewed: [], stateUpdate: 'illicit' })).toThrow('consume its exact owner continuation')
    expect(() => parkOwnerQuestion(before, 'terminal', { kind: 'terminal', cause: 'sandbox', reason: 'Network isolation failed.' }, source, items)).toThrow('terminal sandbox')
    expect(() => parked({ ...before, ownerSessionId: null })).toThrow('host-owned root session')
    expect(() => parked({ ...before, status: 'running' })).toThrow('escalated run')
  })

  it('reserves once, survives JSON restart, consumes once and preserves the original gate and repair route', () => {
    const before = parked(blocked({ repairReturns: [{ stage: 'detective', returnTo: 'devils-advocate' }] }))
    const answer = response(before)
    const accepted = applyScriptedOwnerAnswer(before, answer)
    expect(ownerLifecycleStatus(accepted)).toBe('continuation_pending')
    expect(pendingOwnerResumePlan(accepted)).toMatchObject({ gate: 'A', stage: 'detective' })
    expect(ownerReassessments(accepted, 'A')).toBe(1)
    expect(() => recordGate(accepted, { decision: 'pass', basis: [], evidenceReviewed: [], stateUpdate: 'illicit' })).toThrow('consume its exact owner continuation')
    expect(applyScriptedOwnerAnswer(accepted, answer)).toBe(accepted)
    const recovered = JSON.parse(JSON.stringify(accepted)) as ConductorRun
    assertOwnerLedger(recovered)
    const consumed = consumeOwnerContinuation(recovered, 'question-1')
    expect(consumed.history).toEqual(before.history)
    expect(consumed.repairReturns).toEqual(before.repairReturns)
    expect(ownerContinuationAt(consumed, 1)).toMatchObject({ plan: { gate: 'A', stage: 'detective' } })
    expect(ownerLifecycleStatus(consumed)).toBe('rework')
    expect(pendingOwnerQuestion(consumed)).toBeUndefined()
    expect(pendingOwnerResumePlan(consumed)).toBeUndefined()
    expect(applyScriptedOwnerAnswer(consumed, answer)).toBe(consumed)
    expect(() => consumeOwnerContinuation(consumed, 'question-1')).toThrow('no unconsumed')
    expect(() => applyScriptedOwnerAnswer(consumed, { ...answer, answers: [{ itemId: 'schema', text: 'Different.', optionId: 'v1' }] })).toThrow('conflicting response')
    const next = recordGate(consumed, { decision: 'pass', basis: ['Owner answer assessed.'], evidenceReviewed: ['answer'], stateUpdate: 'Advance.' })
    expect(ownerLifecycleStatus(next)).toBeUndefined()
    assertOwnerLedger(next)
  })

  it('validates all required answers atomically and rejects foreign, stale or non-scripted input', () => {
    const run = parked()
    for (const change of [
      { rootSessionId: SessionId('foreign') }, { expectedRevision: 0 }, { questionId: 'other' },
    ]) expect(() => applyScriptedOwnerAnswer(run, response(run, change))).toThrow('foreign or stale')
    expect(() => applyScriptedOwnerAnswer(run, { ...response(run), source: 'production' } as unknown as ScriptedOwnerResponse)).toThrow('host UI or scripted test provider')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { answers: [] }))).toThrow('every required item')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { answers: [{ itemId: 'schema', text: 'x', optionId: 'absent' }] }))).toThrow('invalid answer')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { answers: [{ itemId: 'other', text: 'x', optionId: 'v1' }] }))).toThrow('invalid answer')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { action: 'approve' }))).toThrow('concrete mandate')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { proposalHash: 'a'.repeat(64) }))).toThrow('exact mandate')
    expect(() => applyScriptedOwnerAnswer(run, response(run, { answers: [{ itemId: 'schema', text: '' }] }))).toThrow('interaction schema')
    const open = parkOwnerQuestion(blocked(), 'question-1', reason, source, [{ id: 'schema', prompt: 'Explain.', options: [] }])
    expect(() => applyScriptedOwnerAnswer(open, response(open))).toThrow('invalid answer')
    expect(applyScriptedOwnerAnswer(open, response(open, { answers: [{ itemId: 'schema', text: 'Canonical schema v2.' }] })).status).toBe('continuation_pending')
  })

  it('records rejection terminally, grants nothing and handles an identical rejection idempotently', () => {
    const run = parked()
    const rejectedResponse = response(run, { action: 'reject', answers: [] })
    const rejected = applyScriptedOwnerAnswer(run, rejectedResponse)
    expect(rejected.status).toBe('aborted')
    expect(ownerLifecycleStatus(rejected)).toBe('aborted')
    expect(ownerReassessments(rejected, 'A')).toBe(0)
    expect(applyScriptedOwnerAnswer(rejected, rejectedResponse)).toBe(rejected)
    expect(() => applyScriptedOwnerAnswer(run, response(run, { action: 'reject' }))).toThrow('rejection cannot')
    expect(() => consumeOwnerContinuation(rejected, 'question-1')).toThrow('no unconsumed')
  })

  it('applies only explicitly confirmed, capability-bounded proposals and invalidates active authority', () => {
    const baseline: ExecutionBaseline = { scopeVersion: 's1', planVersion: 'p1', acceptanceVersion: 'a1', allowedPaths: ['src'],
      excludedPaths: ['secrets'], rollbackReference: 'HEAD', qualityCommands: [] }
    const before = blocked({ baseline, baselineHistory: [baseline], repairReturns: [{ stage: 'strategist', returnTo: 'devils-advocate' }] })
    const run = parkOwnerQuestion(before, 'question-1', { ...reason, cause: 'authority-amendment' }, source, [], proposal)
    expect(() => applyScriptedOwnerAnswer(run, response(run, { action: 'approve', answers: [] }))).toThrow('exact mandate')
    const accepted = applyScriptedOwnerAnswer(run, response(run, { action: 'approve', answers: [], proposalHash: ownerMandateHash(proposal) }))
    expect(effectiveOwnerMandate(accepted)).toEqual(proposal)
    expect(ownerCommandAllowed(before, 'other-catalog-command')).toBe(true)
    expect(ownerCommandAllowed(accepted, 'unit')).toBe(true)
    expect(ownerCommandAllowed(accepted, 'other-catalog-command')).toBe(false)
    const consumed = consumeOwnerContinuation(accepted, 'question-1')
    expect(consumed).toMatchObject({ currentStage: 'strategist', baseline: null, executionAuthorization: null, repairReturns: [] })
    expect(consumed.admission).toBe(before.admission)
    expect(consumed.allowedPaths).toEqual(['src'])
    expect(consumed.baselineHistory).toEqual([baseline])
    expect(accepted.baseline).toBeNull()
  })

  it('enforces cumulative caps independently by gate and preserves the reserved second plan', () => {
    let run = parked()
    for (let attempt = 1; attempt <= 2; attempt++) {
      const accepted = applyScriptedOwnerAnswer(run, response(run, { questionId: `question-${attempt}` }))
      expect(ownerReassessments(accepted, 'A')).toBe(attempt)
      run = consumeOwnerContinuation(accepted, `question-${attempt}`)
      run = recordGate(run, { decision: 'escalate', basis: ['Still needs input.'], evidenceReviewed: [], stateUpdate: 'Ask.' })
      if (attempt === 1) run = parkOwnerQuestion(run, 'question-2', reason, { ...source, childId: SessionId('detective-attempt-2'), attempt: 2 }, items)
    }
    expect(() => parked(run)).toThrow('gate A: 2/2')
    run = { ...run, currentStage: 'strategist' }
    run = recordGate(run, { decision: 'escalate', basis: ['Different owner question.'], evidenceReviewed: [], stateUpdate: 'Ask.' })
    run = parkOwnerQuestion(run, 'question-B', reason, { ...source, childId: SessionId('strategist-attempt-1') }, items)
    expect(ownerReassessments(run, 'B')).toBe(0)
    expect(applyScriptedOwnerAnswer(run, response(run, { questionId: 'question-B' })).status).toBe('continuation_pending')
  })

  it('rejects malformed, stale, forged or causally impossible durable records', () => {
    const run = parked()
    invalid(run, (r) => { r.ownerLedger[0]!.revision = 2 }, 'non-monotonic')
    invalid(run, (r) => { r.ownerRevision = -1 }, 'ownerRevision')
    invalid(run, (r) => { r.budget.maxOwnerReassessmentsPerGate = 0 }, 'positive safe integer')
    invalid(run, (r) => { r.ownerSessionId = SessionId(' ') }, 'ownerSessionId')
    invalid(run, (r) => { r.ownerCapabilities = {} as OwnerMandate }, 'capability snapshot')
    invalid(run, (r) => { question(r).reportHash = 'a'.repeat(64) }, 'captured child output')
    invalid(run, (r) => { question(r).rootSessionId = SessionId('foreign') }, 'exact escalated gate')
    invalid(run, (r) => { question(r).mandateRevision = 1 }, 'mandate is stale')
    invalid(run, (r) => { question(r).baselineHash = 'a'.repeat(64) }, 'unknown historical baseline')
    invalid(run, (r) => { question(r).items.push(question(r).items[0]!) }, 'distinct')
    invalid(run, (r) => { r.status = 'running' }, 'requires status awaiting_owner')
    invalid(run, (r) => { r.history.push({ ...r.history[0]! }) }, 'gate history changed')
    invalid(run, (r) => { r.ownerLedger[0] = { ...r.ownerLedger[0]!, extra: 'forged' } as unknown as OwnerInteraction }, 'interaction schema')
    invalid(run, (r) => { question(r).cause = 'authority-amendment' }, 'requires a concrete proposal')
    invalid(run, (r) => { question(r).items = [] }, 'at least one')
    invalid(blocked(), (r) => { r.status = 'awaiting_owner' }, 'requires a durable')
    invalid(answered(), (r) => { (r.ownerLedger[1] as Extract<OwnerInteraction, { kind: 'answer' }>).plan.stage = 'headsman' }, 'host-derived')
    invalid(answered(), (r) => { r.ownerLedger[1]!.historyLength = 0 }, 'non-monotonic')
    const consumed = consumeOwnerContinuation(answered(), 'question-1')
    invalid(consumed, (r) => { (r.ownerLedger[2] as Extract<OwnerInteraction, { kind: 'consumed' }>).planId = 'other' }, 'not reserved')
    invalid(consumed, (r) => { r.currentStage = 'headsman' }, 'exact target stage')
    expect(ownerContinuationAt(run, 1)).toBeUndefined()
    expect(ownerContinuationAt({ ...consumed, ownerLedger: [consumed.ownerLedger[2]!] }, 1)).toBeUndefined()
    expect(ownerLifecycleStatus(blocked())).toBeUndefined()
  })

  it('rejects forbidden authority changes even when the serialized proposal claims approval', () => {
    const authority = { ...reason, cause: 'authority-amendment' as const }
    const propose = (p: OwnerMandate, run = blocked()) => parkOwnerQuestion(run, 'question-1', authority, source, [], p)
    expect(() => propose(proposal, { ...analysisRun(), ownerSessionId: root, ownerCapabilities: caps, currentStage: 'detective',
      history: blocked().history, status: 'escalated' })).toThrow('analysis cannot')
    expect(() => parkOwnerQuestion(blocked(), 'question-1', reason, source, items, proposal)).toThrow('authority-amendment classification')
    expect(() => propose(proposal, { ...blocked(), ownerCapabilities: null })).toThrow('host-captured')
    expect(() => propose({ ...proposal, excludedPaths: [] })).toThrow('mandatory exclusions')
    for (const path of ['../outside', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'a/./b', '.git/config', 'a\0b']) {
      expect(() => propose({ ...proposal, allowedPaths: [path] })).toThrow('canonical relative')
    }
    expect(() => propose(proposal, { ...blocked(), ownerCapabilities: { ...caps, allowedPaths: ['src'] } })).toThrow('workspace capabilities')
    expect(() => propose({ ...proposal, qualityCommandIds: ['unknown'] })).toThrow('unavailable host command')
    expect(propose({ ...proposal, allowedPaths: ['src/nested'] }, { ...blocked(), ownerCapabilities: { ...caps, allowedPaths: ['src'] } }).status).toBe('awaiting_owner')
    expect(propose({ ...proposal, excludedPaths: ['secrets', '.git'] }, { ...blocked(), excludedPaths: ['secrets', '.git'],
      ownerCapabilities: { ...caps, excludedPaths: ['secrets', '.git'] } }).status).toBe('awaiting_owner')
  })

  it('rejects ledger replay that duplicates receipts, skips a question or exceeds a saved gate allowance', () => {
    const accepted = answered()
    const receipt = accepted.ownerLedger[1]!
    const orphan = { ...clone(accepted), ownerRevision: 1, ownerLedger: [{ ...receipt, revision: 1, previousRevision: 0 }] }
    expect(() =>{  assertOwnerLedger(orphan) }).toThrow('no exact pending question')
    invalid(accepted, (run) => {
      run.ownerLedger.push({ ...receipt, revision: 3, previousRevision: 2 })
      run.ownerRevision = 3
    }, 'already has an accepted response')
    invalid(accepted, (run) => {
      run.ownerLedger.push({ kind: 'rejected', questionId: 'question-1', revision: 3, previousRevision: 2, historyLength: 1 })
      run.ownerRevision = 3
    }, 'rejection must terminate')
    let second = consumeOwnerContinuation(accepted, 'question-1')
    second = recordGate(second, { decision: 'escalate', basis: ['New obstacle.'], evidenceReviewed: [], stateUpdate: 'Ask.' })
    second = parkOwnerQuestion(second, 'question-2', reason, { ...source, childId: SessionId('child-2'), attempt: 2 }, items)
    invalid(second, (run) => { run.budget.maxOwnerReassessmentsPerGate = 1 }, 'reassessment limit exhausted')
    expect(effectiveOwnerMandate({ ...orphan, ownerLedger: [{ ...receipt, kind: 'answer', proposalHash: 'a'.repeat(64) } as OwnerInteraction] })).toEqual({ allowedPaths: ['src'], excludedPaths: ['secrets'], qualityCommandIds: [] })
  })

  it('rejects restoration of authority or repair stacks after an accepted amendment', () => {
    const baseline: ExecutionBaseline = { scopeVersion: 's1', planVersion: 'p1', acceptanceVersion: 'a1', allowedPaths: ['src'],
      excludedPaths: ['secrets'], rollbackReference: 'HEAD', qualityCommands: [] }
    const run = parkOwnerQuestion(blocked({ baseline, baselineHistory: [baseline] }), 'question-1', { ...reason, cause: 'authority-amendment' }, source, [], proposal)
    invalid(run, (state) => { state.baseline = null }, 'pending question baseline is stale')
    const accepted = applyScriptedOwnerAnswer(run, response(run, { action: 'approve', answers: [], proposalHash: ownerMandateHash(proposal) }))
    invalid(accepted, (state) => { state.baseline = baseline }, 'accepted mandate amendment must invalidate')
    const consumed = consumeOwnerContinuation(accepted, 'question-1')
    invalid(consumed, (state) => { state.repairReturns = [{ stage: 'strategist', returnTo: 'devils-advocate' }] }, 'clear the superseded')
    invalid(consumed, (state) => { state.baseline = baseline }, 'mandate amendment must invalidate')
  })
})
