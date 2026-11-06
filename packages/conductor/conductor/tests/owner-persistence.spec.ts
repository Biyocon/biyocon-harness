import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, QualityCommandId, SessionConductorRunStore, applyScriptedOwnerAnswer, consumeOwnerContinuation, contentHash, createRun, executionBaselineHash, inspectRunRecord, ownerMandateHash, parseRun, parkOwnerQuestion, recordGate, resumeRun, serializeRun, validateResumable } from '../src/index.ts'
import { validateIntakeHistory } from '../src/intake-history.ts'
import type { ConductorRun } from '../src/index.ts'
import { analysisReply, analysisRun, implementationAdmission } from './intake-fixtures.ts'

function initial() {
  return createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: SessionId('owner-root'),
    admission: implementationAdmission(), objective: 'Preserve the owner mandate.',
    authority: { owner: 'user' },
  })
}

function parked(run: ConductorRun = initial()) {
  const report = { status: 'blocked', clarification: 'Which naming convention is authoritative?' }
  const escalated = recordGate({ ...run, ownerSessionId: SessionId('owner-root') }, {
    decision: 'escalate', basis: ['Owner clarification required.'], evidenceReviewed: [], stateUpdate: 'Await owner clarification.',
    ...run.admission.purpose === 'analysis' && run.analysisMode === 'producer'
      ? { analysis: { mode: 'producer' as const, childId: SessionId('detective-attempt-1') } } : {},
  })
  return parkOwnerQuestion(escalated, 'owner-question-1',
    { kind: 'recoverable', cause: 'clarification', reason: 'Which naming convention is authoritative?' },
    { sourceKind: 'child', childId: SessionId('detective-attempt-1'), attempt: 1, reportHash: contentHash(JSON.stringify(report)), report },
    [{ id: 'naming', prompt: 'Choose the naming convention.', options: [] }])
}

function answered(run: ConductorRun) {
  return applyScriptedOwnerAnswer(run, {
    source: 'scripted-test-provider', rootSessionId: SessionId('owner-root'),
    questionId: 'owner-question-1', expectedRevision: 1, action: 'answer_continue',
    answers: [{ itemId: 'naming', text: 'Use the documented project naming convention.' }],
  })
}

describe('owner-ledger durable records' , () => {
  it('refuses version 4 with an explicit version-5 error before inspecting other fields', () => {
    expect(() => parseRun(JSON.stringify({ recordFormatVersion: 4 })))
      .toThrow('Conductor run record format 4 is unsupported; expected 5')
    expect(parseRun(serializeRun(initial()))).toEqual(initial())
  })

  it('keeps a format-4 run untouched while a distinct new run is saved', async () => {
    const session = Session.create(SessionId('owner-root'))
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    const oldId = ConductorRunId('CON-2026-0037')
    const oldRecord = JSON.stringify({ recordFormatVersion: 4, privatePayload: 'synthetic secret' })
    session.append('conductor/checkpoint', { runId: oldId, record: oldRecord })
    await expect(store.load(oldId)).rejects.toThrow('cannot be resumed (format 4)')
    await expect(resumeRun(store, oldId)).rejects.toThrow('cannot be resumed (format 4)')
    const fresh = { ...initial(), runId: ConductorRunId('CON-2026-0038') }
    await store.save(fresh)
    await expect(store.load(fresh.runId)).resolves.toEqual(fresh)
    expect(session.events.find(event => event.type === 'conductor/checkpoint')?.data.record).toBe(oldRecord)
  })

  it('reports unknown format without exposing malformed or nonsensical records', async () => {
    const runId = ConductorRunId('CON-2026-0037')
    for (const record of ['42', 'null', '[]', '{}', '{"recordFormatVersion":1.5}']) {
      expect(inspectRunRecord(runId, record)).toEqual({ kind: 'unavailable', format: null })
    }
    const session = Session.create(SessionId('owner-root'))
    session.append('conductor/checkpoint', { runId, record: '{synthetic private bytes' })
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    await expect(store.load(runId)).rejects.toThrow('cannot be resumed (format unknown)')
  })

  it('binds checkpoints to the actual parent session and keyed run identity', async () => {
    const session = Session.create(SessionId('owner-root'))
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    const run = initial()
    await store.save(run)
    await expect(store.load(run.runId)).resolves.toEqual(run)
    await expect(store.save({ ...run, ownerSessionId: SessionId('foreign-root') }))
      .rejects.toThrow('another owning root session')
    session.append('conductor/checkpoint', { runId: run.runId,
      record: serializeRun({ ...run, ownerSessionId: SessionId('foreign-root') }) })
    await expect(store.load(run.runId)).rejects.toThrow('cannot be resumed (format 5)')
    session.append('conductor/checkpoint', { runId: run.runId,
      record: serializeRun({ ...run, runId: ConductorRunId('CON-2026-0038') }) })
    await expect(store.load(run.runId)).rejects.toThrow('cannot be resumed (format 5)')
  })

  it.each(['implementation', 'analysis'] as const)('retains %s owner questions and reserved continuations across restart', async (purpose) => {
    const question = parked(purpose === 'analysis' ? analysisRun() : initial())
    const session = Session.create(SessionId('owner-root'))
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    await store.save(question)
    const restored = await new SessionConductorRunStore(session, () => Promise.resolve()).load(question.runId)
    expect(restored).toEqual(question)
    expect(() => { validateResumable(restored!) }).toThrow('owner resumption requires an exact host reservation')
    const response = answered(restored!)
    expect(parseRun(serializeRun(response))).toEqual(response)
    expect(() => { validateResumable(response) }).toThrow('owner resumption requires an exact host reservation')
    const consumed = consumeOwnerContinuation(parseRun(serializeRun(response)), 'owner-question-1')
    expect(parseRun(serializeRun(consumed))).toEqual(consumed)
    expect(() => { validateResumable(consumed) }).not.toThrow()
    expect(consumed.history).toEqual(question.history)
    expect(consumed.allowedPaths).toEqual(question.allowedPaths)
    expect(consumed.executionAuthorization).toBeNull()
    const rejected = applyScriptedOwnerAnswer(restored!, {
      source: 'scripted-test-provider', rootSessionId: SessionId('owner-root'),
      questionId: 'owner-question-1', expectedRevision: 1, action: 'reject', answers: [],
    })
    expect(parseRun(serializeRun(rejected))).toEqual(rejected)
    expect(() => { validateResumable(rejected) }).toThrow('terminal run cannot resume')
  })

  it('allows later gates only after a consumed continuation and refuses ledger removal', () => {
    const consumed = consumeOwnerContinuation(answered(parked()), 'owner-question-1')
    const advanced = recordGate(consumed, {
      decision: 'pass', basis: ['Owner clarified the convention.'], evidenceReviewed: [], stateUpdate: 'Detective completed.',
    })
    expect(parseRun(serializeRun(advanced))).toEqual(advanced)
    expect(() => parseRun(serializeRun({ ...advanced, ownerRevision: 0, ownerLedger: [] })))
      .toThrow('history cannot continue after a terminal gate')
    const forged = structuredClone(consumed)
    const answer = forged.ownerLedger[1]!
    if (answer.kind !== 'answer') throw new Error('test requires answer')
    answer.plan.stage = 'headsman'
    expect(() => parseRun(serializeRun(forged))).toThrow('resume plan differs')
  })

  it('preserves a pending analysis repair return across owner clarification at an earlier stage', () => {
    const needsPlan = recordGate(analysisRun('devils-advocate'), {
      decision: 'rework', defectClass: 'plan', nextStage: 'strategist',
      analysis: { mode: 'producer', childId: SessionId('producer-plan-1') },
      basis: ['Plan must be clarified.'], evidenceReviewed: [], stateUpdate: 'Repair plan.',
    })
    const consumed = consumeOwnerContinuation(answered(parked(needsPlan)), 'owner-question-1')
    const report = analysisReply(consumed, 'strategist')
    const advanced = recordGate({ ...consumed, analysisReports: [report] }, {
      decision: 'pass', basis: [report.summary], evidenceReviewed: report.material_ids, stateUpdate: report.summary,
    })
    expect(advanced.currentStage).toBe('devils-advocate')
    expect(parseRun(serializeRun(advanced))).toEqual(advanced)
  })

  it('retains historical baselines while an accepted amendment immediately revokes execution', () => {
    const pass = { decision: 'pass' as const, basis: ['Approved evidence.'], evidenceReviewed: [], stateUpdate: 'Advance.' }
    let run = createRun(ConductorRunId('CON-2026-0037'), {
      ownerSessionId: SessionId('owner-root'), ownerCapabilities: { allowedPaths: ['.'], excludedPaths: ['src/private'], qualityCommandIds: ['unit'] },
      admission: implementationAdmission(), objective: 'Preserve the owner mandate.', authority: { owner: 'user' },
      allowedPaths: ['src'], excludedPaths: ['src/private'],
    })
    run = recordGate(recordGate(run, pass), pass)
    const baseline = { scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['src'], excludedPaths: ['src/private'], rollbackReference: 'HEAD', qualityCommands: [] }
    const baselineHash = executionBaselineHash(baseline)
    run = recordGate({ ...run, baseline, baselineHistory: [baseline], executionAuthorization: {
      executionBaselineHash: baselineHash, effectProfile: { filesystem: 'workspace-write', quality: 'none', external: 'none' },
    } }, { ...pass, executionBaselineHash: baselineHash })
    const escalated = recordGate(run, { decision: 'escalate', basis: ['Additional path required.'], evidenceReviewed: [], stateUpdate: 'Await mandate.' })
    const report = { status: 'blocked', change_requests: [{ target: 'authority', reason: 'Additional path required.' }] }
    const proposal = { allowedPaths: ['src', 'docs'], excludedPaths: ['src/private'], qualityCommandIds: ['unit'] }
    const question = parkOwnerQuestion(escalated, 'amendment-question',
      { kind: 'recoverable', cause: 'authority-amendment', reason: 'Additional path required.' },
      { sourceKind: 'child', childId: SessionId('headsman-1'), attempt: 1, reportHash: contentHash(JSON.stringify(report)), report }, [], proposal)
    expect(parseRun(serializeRun(question))).toEqual(question)
    const response = applyScriptedOwnerAnswer(question, {
      source: 'scripted-test-provider', rootSessionId: SessionId('owner-root'), questionId: 'amendment-question', expectedRevision: 1,
      action: 'approve', answers: [], proposalHash: ownerMandateHash(proposal),
    })
    expect(response.baseline).toBeNull()
    expect(response.executionAuthorization).toBeNull()
    expect(parseRun(serializeRun(response))).toEqual(response)
    const consumed = consumeOwnerContinuation(parseRun(serializeRun(response)), 'amendment-question')
    expect(consumed.currentStage).toBe('strategist')
    expect(consumed.allowedPaths).toEqual(['src'])
    expect(consumed.baselineHistory).toEqual([baseline])
    expect(parseRun(serializeRun(consumed))).toEqual(consumed)
    const replanned = recordGate(consumed, pass)
    expect(parseRun(serializeRun(replanned))).toEqual(replanned)
    const newBaseline = { ...baseline, planVersion: 'plan-2', allowedPaths: ['src', 'docs'], qualityCommands: [
      { id: QualityCommandId('unit'), definitionHash: 'a'.repeat(64), requiredGates: ['D' as const] },
    ] }
    const newHash = executionBaselineHash(newBaseline)
    const reapproved = recordGate({ ...replanned, baseline: newBaseline, baselineHistory: [...replanned.baselineHistory, newBaseline],
      executionAuthorization: { executionBaselineHash: newHash,
        effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' } },
    }, { ...pass, executionBaselineHash: newHash })
    expect(parseRun(serializeRun(reapproved))).toEqual(reapproved)
    expect(() => parseRun(serializeRun({ ...reapproved, baseline: { ...newBaseline, qualityCommands: [
      { ...newBaseline.qualityCommands[0]!, id: QualityCommandId('not-approved') },
    ] } }))).toThrow('active baseline command exceeds the effective owner mandate')
    expect(() => parseRun(serializeRun({ ...consumed, baseline, executionAuthorization: run.executionAuthorization })))
      .toThrow('mandate amendment must invalidate active baseline and authorization')
  })

  it('rejects an owner continuation attached to a non-escalated gate', () => {
    const consumed = consumeOwnerContinuation(answered(parked()), 'owner-question-1')
    const forged = structuredClone(consumed)
    const source = forged.history[0]!
    if (source.kind !== 'evaluated') throw new Error('test requires evaluated gate')
    source.decision = 'pass'
    source.nextStage = 'strategist'
    expect(() => { validateIntakeHistory(forged) }).toThrow('owner continuation must follow its documented escalation')
  })

  it('requires an Arbiter decision even when an awaiting-authorization record names closeout', () => {
    expect(() => parseRun(serializeRun({ ...initial(), status: 'awaiting_authorization', currentStage: 'closeout' })))
      .toThrow('awaiting authorization requires closeout stage and an Arbiter GO')
    expect(parseRun(serializeRun(analysisRun()))).toEqual(analysisRun())
  })

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null, '2'])(
    'rejects a malformed snapshotted owner reassessment limit %s', (limit) => {
      const run = initial()
      expect(() => parseRun(JSON.stringify({ ...run, budget: { ...run.budget, maxOwnerReassessmentsPerGate: limit } })))
        .toThrow('budget.maxOwnerReassessmentsPerGate must be a positive safe integer')
    })
})
