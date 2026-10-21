import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  ConductorRunId,
  InMemoryConductorRunStore,
  SessionConductorRunStore,
  parseRun,
  recordGate,
  resumeRun,
  serializeRun,
  validateResumable,
} from '../src/index.ts'
import type { ConductorRun, GateRecord } from '../src/index.ts'

function makeRun(overrides: Partial<ConductorRun> = {}): ConductorRun {
  return {
    runId: ConductorRunId('CON-2026-0001'),
    objective: 'ship the feature',
    scope: [],
    inputArtifacts: [],
    allowedPaths: [],
    excludedPaths: [],
    sourceBaseline: null,
    authority: { owner: 'user', permittedActions: ['read'] },
    constraints: [],
    acceptanceCriteria: [],
    budget: { maxReworkCycles: 3, maxRalphRounds: 0 },
    baseline: null,
    currentStage: 'detective',
    history: [],
    specialistReports: [],
    status: 'running',
    ...overrides,
  }
}

function gateRecord(partial: Pick<GateRecord, 'gate' | 'stage' | 'decision'> & Partial<GateRecord>): GateRecord {
  return { basis: [], evidenceReviewed: [], stateUpdate: '', ...partial }
}

function makeClosedRun(): ConductorRun {
  return makeRun({
    acceptanceCriteria: ['feature works'],
    authority: { owner: 'user', permittedActions: ['read', 'deploy'] },
    currentStage: 'closeout',
    history: [gateRecord({
      gate: 'G', stage: 'arbiter', decision: 'pass', nextStage: 'closeout',
      basis: ['verified'], evidenceReviewed: ['report'], stateUpdate: 'move to closeout',
    })],
    status: 'closed',
    decision: {
      run_id: 'CON-2026-0001', decision: 'go', basis: ['verified'], evidence_reviewed: ['report'],
      conditions: [], open_risks: [], required_follow_up: [],
    },
    closeout: {
      run_id: 'CON-2026-0001', arbiter_decision: 'go', authorized_by: 'user', authorized_action: 'deploy',
      actions_taken: ['recorded deployment'], outcome_evidence: ['health check'], unverified_items: [], open_risks: [],
      follow_up: [],
      traceability: {
        mandate: ['request'], baseline: ['HEAD'], changes: ['release'], verification: ['health check'], decision: ['Gate G'],
      },
      status: 'closed',
    },
  })
}

function specialistReport() {
  return {
    run_id: 'CON-2026-0001',
    stage: 'headsman',
    baseline_ref: 'HEAD',
    source_baseline: 'HEAD',
    status: 'ready',
    summary: 'implementation complete',
    evidence: [{ kind: 'test', reference: 'focused tests', outcome: 'passed' }],
    findings: [{ id: 'F-1', severity: 'low', description: 'minor', impact: 'none' }],
    assumptions: ['baseline is current'],
    blockers: [],
    artifacts: ['report.md'],
    change_requests: [{ target: 'plan', reason: 'clarify', impact: 'none' }],
    execution_baseline: {
      scopeVersion: 'scope-v1', planVersion: 'plan-v1', acceptanceVersion: 'accept-v1',
      allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD',
    },
    recommended_transition: { target: 'conductor', rationale: 'evaluate' },
    confidence: 'high',
  }
}

describe('dsh-conductor persistence', () => {
  it('round-trips a run through the JSON wire format unchanged', () => {
    const run = makeRun({
      currentStage: 'auditor',
      history: [gateRecord({ gate: 'E', stage: 'auditor', decision: 'rework', defectClass: 'implementation', nextStage: 'headsman' })],
      status: 'rework',
    })
    expect(parseRun(serializeRun(run))).toEqual(run)
  })

  it('rejects invalid JSON and non-object records', () => {
    expect(() => parseRun('not json')).toThrow(/not valid JSON/)
    expect(() => parseRun('42')).toThrow(/JSON object/)
    expect(() => parseRun('null')).toThrow(/JSON object/)
    expect(() => parseRun('[]')).toThrow(/JSON object/)
  })

  it('rejects records with invalid discriminant tags', () => {
    expect(() => parseRun(JSON.stringify({ ...makeRun(), status: 'bogus' }))).toThrow(/invalid status/)
    expect(() => parseRun(JSON.stringify({ ...makeRun(), currentStage: 'bogus' }))).toThrow(/invalid currentStage/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      history: [{ gate: 'A', stage: 'detective', decision: 'bogus', basis: [], evidenceReviewed: [], stateUpdate: '' }],
    }))).toThrow(/invalid decision/)
  })

  it('rejects malformed nested durable state before it reaches resume logic', () => {
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      authority: { owner: 'user', permittedActions: ['delete'] },
    }))).toThrow(/invalid action/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      baseline: {
        scopeVersion: 'scope-v1',
        planVersion: 'plan-v1',
        acceptanceVersion: 'acceptance-v1',
        allowedPaths: [42],
        excludedPaths: [],
        rollbackReference: 'HEAD',
      },
    }))).toThrow(/baseline.allowedPaths/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      allowedPaths: ['packages/conductor'],
      baseline: {
        scopeVersion: 'scope-v1',
        planVersion: 'plan-v1',
        acceptanceVersion: 'acceptance-v1',
        allowedPaths: ['.'],
        excludedPaths: [],
        rollbackReference: 'HEAD',
      },
    }))).toThrow(/baseline paths must match/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      excludedPaths: ['secrets'],
      baseline: {
        scopeVersion: 'scope-v1',
        planVersion: 'plan-v1',
        acceptanceVersion: 'acceptance-v1',
        allowedPaths: [],
        excludedPaths: [],
        rollbackReference: 'HEAD',
      },
    }))).toThrow(/baseline paths must match/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      history: [gateRecord({ gate: 'A', stage: 'auditor', decision: 'pass', nextStage: 'strategist' })],
    }))).toThrow(/gate A cannot belong to stage auditor/)
    const { specialistReports: _omitted, ...withoutReports } = makeRun()
    expect(() => parseRun(JSON.stringify(withoutReports))).toThrow(/specialistReports must be an array/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(), acceptanceCriteria: [''],
    }))).toThrow(/acceptanceCriteria must contain only non-empty normalized strings/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(), acceptanceCriteria: ['same', 'same'],
    }))).toThrow(/acceptanceCriteria must not contain duplicates/)
  })

  it('rejects semantically impossible gate records and lifecycle status', () => {
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'headsman' })],
    }))).toThrow(/pass has invalid nextStage/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'rework', currentStage: 'headsman' }),
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'rework', nextStage: 'headsman' })],
    }))).toThrow(/rework has invalid defectClass/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'abort' })],
    }))).toThrow(/status running does not match/)
  })

  it('rejects lifecycle records whose decision or closeout cannot support the status', () => {
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'awaiting_authorization', currentStage: 'closeout' }),
      decision: {
        run_id: 'CON-2026-0002',
        decision: 'go',
        basis: ['verified'],
        evidence_reviewed: ['report'],
        conditions: [],
        open_risks: [],
        required_follow_up: [],
      },
    }))).toThrow(/decision.run_id must match/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'closed', currentStage: 'closeout' }),
      decision: {
        run_id: 'CON-2026-0001',
        decision: 'go',
        basis: ['verified'],
        evidence_reviewed: ['report'],
        conditions: [],
        open_risks: [],
        required_follow_up: [],
      },
    }))).toThrow(/requires closeout/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'awaiting_authorization', currentStage: 'closeout' }),
      decision: {
        run_id: 'CON-2026-0001', decision: 'go', basis: [''], evidence_reviewed: ['report'],
        conditions: [], open_risks: [], required_follow_up: [],
      },
    }))).toThrow(/decision.basis must contain only non-empty normalized strings/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'awaiting_authorization', currentStage: 'closeout' }),
      decision: {
        run_id: 'CON-2026-0001', decision: 'go', basis: ['verified'], evidence_reviewed: [],
        conditions: [], open_risks: [], required_follow_up: [],
      },
    }))).toThrow(/GO requires a non-empty basis and reviewed evidence/)
  })

  it('rejects tampered durable closeout authority and outcome evidence', () => {
    const valid = makeClosedRun()
    expect(parseRun(serializeRun(valid))).toEqual(valid)
    expect(() => parseRun(serializeRun({
      ...valid, closeout: { ...valid.closeout!, authorized_by: 'impostor' },
    }))).toThrow(/authorized_by must match authority.owner/)
    expect(() => parseRun(serializeRun({
      ...valid,
      authority: { owner: 'user', permittedActions: ['read'] },
    }))).toThrow(/authorized_action is outside the run authority/)
    expect(() => parseRun(serializeRun({
      ...valid, closeout: { ...valid.closeout!, outcome_evidence: [] },
    }))).toThrow(/outcome_evidence must not be empty/)
  })

  it('stores, loads, and deletes runs keyed by run id without aliasing', async () => {
    const store = new InMemoryConductorRunStore()
    const run = makeRun()
    await store.save(run)
    const loaded = await store.load(run.runId)
    expect(loaded).toEqual(run)
    expect(loaded).not.toBe(run)
    await store.delete(run.runId)
    expect(await store.load(run.runId)).toBeUndefined()
  })

  it('reconstructs the latest run from durable session checkpoints and flushes every mutation', async () => {
    const session = Session.create(SessionId('conductor-checkpoints'))
    let flushes = 0
    const store = new SessionConductorRunStore(session, () => {
      flushes += 1
      return Promise.resolve()
    })
    const initial = makeRun()
    await store.save(initial)
    const advanced = recordGate(initial, {
      decision: 'pass', basis: ['scope clear'], evidenceReviewed: ['report'], stateUpdate: 'advance',
    })
    await store.save(advanced)
    const reopened = new SessionConductorRunStore(session, () => Promise.resolve())
    expect(await reopened.load(initial.runId)).toEqual(advanced)
    expect(flushes).toBe(2)
    await store.delete(initial.runId)
    expect(await reopened.load(initial.runId)).toBeUndefined()
    expect(flushes).toBe(3)
  })

  it('rejects resume of a closed, aborted, or escalated run', () => {
    expect(() => { validateResumable(makeRun({ status: 'closed' })) }).toThrow(/closed/)
    expect(() => { validateResumable(makeRun({ status: 'aborted' })) }).toThrow(/aborted/)
    expect(() => { validateResumable(makeRun({ status: 'escalated' })) }).toThrow(/owner resolution/)
  })

  it('rejects a run with no gate history parked past the initial stage', () => {
    expect(() => { validateResumable(makeRun({ currentStage: 'auditor' })) }).toThrow(/no gate history/)
  })

  it('rejects a run whose stage does not match its last documented gate', () => {
    const run = makeRun({
      currentStage: 'auditor',
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'strategist' })],
    })
    expect(() => { validateResumable(run) }).toThrow(/does not match last gate A/)
  })

  it('rejects a run whose documented history skips a stage', () => {
    const run = makeRun({
      currentStage: 'devils-advocate',
      history: [gateRecord({ gate: 'B', stage: 'strategist', decision: 'pass', nextStage: 'devils-advocate' })],
    })
    expect(() => { validateResumable(run) }).toThrow(/history jumps to gate B/)
  })

  it('resumes a run at exactly its last documented, valid state', async () => {
    const store = new InMemoryConductorRunStore()
    const advanced = recordGate(makeRun({ currentStage: 'detective' }), {
      decision: 'pass', basis: ['scope clear'], evidenceReviewed: ['report'], stateUpdate: 'advance',
    })
    await store.save(advanced)
    const resumed = await resumeRun(store, advanced.runId)
    expect(resumed.currentStage).toBe('strategist')
    expect(resumed.history).toHaveLength(1)
  })

  it('throws when resuming an unknown run id', async () => {
    const store = new InMemoryConductorRunStore()
    await expect(resumeRun(store, ConductorRunId('CON-9999-9999'))).rejects.toThrow(/not found/)
  })

  it('round-trips a complete specialist report through every nested durable field', () => {
    const run = makeRun({ specialistReports: [specialistReport() as never] })
    expect(parseRun(serializeRun(run))).toEqual(run)
  })

  it('rejects malformed top-level fields, authority, budgets, and gate records', () => {
    const invalid: Array<[unknown, RegExp]> = [
      [{ ...makeRun(), runId: 'bad' }, /invalid runId/],
      [{ ...makeRun(), objective: ' ' }, /objective/],
      [{ ...makeRun(), scope: ['same', 'same'] }, /scope.*duplicates/],
      [{ ...makeRun(), inputArtifacts: [1] }, /inputArtifacts/],
      [{ ...makeRun(), allowedPaths: [''] }, /allowedPaths/],
      [{ ...makeRun(), excludedPaths: ['x', 'x'] }, /excludedPaths.*duplicates/],
      [{ ...makeRun(), sourceBaseline: '' }, /sourceBaseline/],
      [{ ...makeRun(), authority: null }, /authority must be an object/],
      [{ ...makeRun(), authority: { owner: '', permittedActions: [] } }, /authority.owner/],
      [{ ...makeRun(), authority: { owner: 'user', permittedActions: ['read', 'read'] } }, /permittedActions.*duplicates/],
      [{ ...makeRun(), constraints: [' '] }, /constraints/],
      [{ ...makeRun(), budget: { maxReworkCycles: 0, maxRalphRounds: 0 } }, /maxReworkCycles/],
      [{ ...makeRun(), budget: { maxReworkCycles: 1, maxRalphRounds: -1 } }, /maxRalphRounds/],
      [{ ...makeRun(), baseline: [] }, /baseline must be an object/],
      [{ ...makeRun(), baseline: {
        scopeVersion: 1, planVersion: 'p', acceptanceVersion: 'a',
        allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD',
      } }, /baseline.scopeVersion/],
      [{ ...makeRun(), history: null }, /history must be an array/],
      [{ ...makeRun(), history: [null] }, /history entry must be an object/],
      [{ ...makeRun(), history: [gateRecord({ gate: 'bogus' as never, stage: 'detective', decision: 'pass' })] }, /invalid gate/],
      [{ ...makeRun(), history: [gateRecord({ gate: 'A', stage: 'bogus' as never, decision: 'pass' })] }, /invalid stage/],
      [{ ...makeRun(), history: [gateRecord({
        gate: 'A', stage: 'detective', decision: 'rework', defectClass: 'bogus' as never,
      })] }, /invalid defectClass/],
      [{ ...makeRun(), history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'bogus' as never })] }, /invalid nextStage/],
      [{ ...makeRun(), history: [{ ...gateRecord({ gate: 'A', stage: 'detective', decision: 'pass' }), basis: [1] }] }, /history.basis/],
      [{ ...makeRun(), history: [{ ...gateRecord({ gate: 'A', stage: 'detective', decision: 'pass' }), evidenceReviewed: [1] }] }, /history.evidenceReviewed/],
      [{ ...makeRun(), history: [{ ...gateRecord({ gate: 'A', stage: 'detective', decision: 'pass' }), stateUpdate: 1 }] }, /history.stateUpdate/],
      [{ ...makeRun(), status: 'aborted', history: [gateRecord({
        gate: 'A', stage: 'detective', decision: 'abort', nextStage: 'detective',
      })] }, /abort cannot carry/],
    ]
    for (const [record, message] of invalid) {
      expect(() => parseRun(JSON.stringify(record))).toThrow(message)
    }
  })

  it('rejects every malformed specialist report collection and nested record', () => {
    const valid = specialistReport()
    const malformed: Array<[unknown, RegExp]> = [
      [null, /specialistReports\[0\].*object/],
      [{ ...valid, run_id: 'CON-2026-9999' }, /run_id must match/],
      [{ ...valid, stage: 'arbiter' }, /stage is invalid/],
      [{ ...valid, baseline_ref: 1 }, /baseline_ref/],
      [{ ...valid, source_baseline: 1 }, /source_baseline/],
      [{ ...valid, status: 'unknown' }, /status is invalid/],
      [{ ...valid, summary: 1 }, /summary/],
      [{ ...valid, evidence: null }, /evidence must be an array/],
      [{ ...valid, evidence: [null] }, /evidence\[0\].*object/],
      [{ ...valid, evidence: [{ kind: 'unknown', reference: 'r', outcome: 'o' }] }, /evidence kind/],
      [{ ...valid, evidence: [{ kind: 'test', reference: 1, outcome: 'o' }] }, /evidence.reference/],
      [{ ...valid, evidence: [{ kind: 'test', reference: 'r', outcome: 1 }] }, /evidence.outcome/],
      [{ ...valid, findings: null }, /findings must be an array/],
      [{ ...valid, findings: [null] }, /findings\[0\].*object/],
      [{ ...valid, findings: [{ id: 1, severity: 'low', description: 'd', impact: 'i' }] }, /findings.id/],
      [{ ...valid, findings: [{ id: 'F', severity: 'unknown', description: 'd', impact: 'i' }] }, /finding severity/],
      [{ ...valid, findings: [{ id: 'F', severity: 'low', description: 1, impact: 'i' }] }, /findings.description/],
      [{ ...valid, findings: [{ id: 'F', severity: 'low', description: 'd', impact: 1 }] }, /findings.impact/],
      [{ ...valid, assumptions: [1] }, /assumptions/],
      [{ ...valid, blockers: [1] }, /blockers/],
      [{ ...valid, artifacts: [1] }, /artifacts/],
      [{ ...valid, change_requests: null }, /change_requests must be an array/],
      [{ ...valid, change_requests: [null] }, /change_requests\[0\].*object/],
      [{ ...valid, change_requests: [{ target: 'unknown', reason: 'r', impact: 'i' }] }, /target is invalid/],
      [{ ...valid, change_requests: [{ target: 'plan', reason: 1, impact: 'i' }] }, /change_requests.reason/],
      [{ ...valid, change_requests: [{ target: 'plan', reason: 'r', impact: 1 }] }, /change_requests.impact/],
      [{ ...valid, recommended_transition: null }, /recommended_transition.*object/],
      [{ ...valid, recommended_transition: { target: 'strategist', rationale: 'r' } }, /return to conductor/],
      [{ ...valid, recommended_transition: { target: 'conductor', rationale: 1 } }, /rationale/],
      [{ ...valid, confidence: 'unknown' }, /confidence/],
    ]
    for (const [report, message] of malformed) {
      expect(() => parseRun(JSON.stringify(makeRun({ specialistReports: [report as never] })))).toThrow(message)
    }
  })

  it('rejects malformed decisions and closeout records at the durable boundary', () => {
    const closed = makeClosedRun()
    const decision = closed.decision!
    const closeout = closed.closeout!
    const invalid: Array<[ConductorRun, RegExp]> = [
      [{ ...closed, decision: null as never }, /decision must be an object/],
      [{ ...closed, decision: { ...decision, decision: 'unknown' as never } }, /invalid decision.decision/],
      [{ ...closed, decision: { ...decision, conditions: [' '] } }, /decision.conditions/],
      [{ ...closed, decision: { ...decision, basis: [] } }, /Arbiter GO/],
      [{ ...closed, closeout: { ...closeout, arbiter_decision: 'no-go' as never } }, /arbiter_decision/],
      [{ ...closed, closeout: { ...closeout, authorized_action: 'unknown' as never } }, /authorized_action/],
      [{ ...closed, closeout: { ...closeout, follow_up: null as never } }, /follow_up must be an array/],
      [{ ...closed, closeout: { ...closeout, follow_up: [null as never] } }, /follow_up\[0\].*object/],
      [{ ...closed, closeout: { ...closeout, follow_up: [{ owner: '', due_condition: 'later' }] } }, /follow_up\[0\].owner/],
      [{ ...closed, closeout: { ...closeout, follow_up: [{ owner: 'owner', due_condition: '' }] } }, /due_condition/],
      [{ ...closed, closeout: { ...closeout, traceability: null as never } }, /traceability must be an object/],
      [{ ...closed, closeout: { ...closeout, traceability: { ...closeout.traceability, mandate: [' '] } } }, /traceability.mandate/],
      [{ ...closed, closeout: { ...closeout, status: 'running' as never } }, /closeout.status/],
      [{ ...closed, closeout: { ...closeout, run_id: 'CON-2026-9999' } }, /closeout.run_id must match/],
    ]
    for (const [record, message] of invalid) {
      expect(() => parseRun(serializeRun(record))).toThrow(message)
    }
  })

  it('folds unrelated checkpoints, tombstones, and missing keys in the session store', async () => {
    const session = Session.create(SessionId('conductor-checkpoint-fold'))
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    const run = makeRun()
    session.append('conductor/checkpoint', { runId: ConductorRunId('CON-2026-9999'), record: serializeRun(run) })
    expect(await store.load(run.runId)).toBeUndefined()
    await store.save(run)
    await store.delete(run.runId)
    expect(await store.load(run.runId)).toBeUndefined()
  })

  it('accepts an untouched intake run as resumable', () => {
    expect(() => { validateResumable(makeRun({ currentStage: 'intake' })) }).not.toThrow()
  })

  it('validates lifecycle status alternatives and a documented same-stage successor', () => {
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'awaiting_authorization', currentStage: 'auditor' }),
      decision: {
        run_id: 'CON-2026-0001', decision: 'go', basis: ['verified'], evidence_reviewed: ['report'],
        conditions: [], open_risks: [], required_follow_up: [],
      },
    }))).toThrow(/awaiting authorization requires/)

    const escalated = makeRun({
      status: 'escalated',
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'escalate' })],
    })
    expect(parseRun(serializeRun(escalated))).toEqual(escalated)

    const sameStage = makeRun({
      currentStage: 'detective',
      status: 'rework',
      history: [gateRecord({ gate: 'A', stage: 'detective', decision: 'rework' })],
    })
    expect(() => { validateResumable(sameStage) }).not.toThrow()
  })
})
