import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import {
  ConductorRunId,
  InMemoryConductorRunStore,
  QualityCommandId,
  QualityEvidenceId,
  SessionConductorRunStore,
  executionBaselineHash,
  parseRun,
  recordGate,
  resumeRun,
  serializeRun,
  validateResumable,
} from '../src/index.ts'
import type { ConductorRun, GateRecord, QualityCommandBinding } from '../src/index.ts'

function makeRun(overrides: Partial<ConductorRun> = {}): ConductorRun {
  return {
    recordFormatVersion: 1,
    runId: ConductorRunId('CON-2026-0001'),
    objective: 'ship the feature',
    scope: [],
    inputArtifacts: [],
    allowedPaths: [],
    excludedPaths: [],
    sourceBaseline: null,
    authority: { owner: 'user' },
    constraints: [],
    acceptanceCriteria: [],
    budget: { maxReworkCycles: 3, maxRalphRounds: 0 },
    baselineHistory: [],
    baseline: null,
    executionAuthorization: null,
    currentStage: 'detective',
    history: [],
    specialistReports: [],
    qualityExecutions: [],
    status: 'running',
    ...overrides,
  }
}

function gateRecord(partial: Pick<GateRecord, 'gate' | 'stage' | 'decision'> & Partial<GateRecord>): GateRecord {
  return { basis: [], evidenceReviewed: [], stateUpdate: '', ...partial }
}

function makeClosedRun(): ConductorRun {
  const baseline = {
    scopeVersion: 'scope-v1', planVersion: 'plan-v1', acceptanceVersion: 'accept-v1',
    allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD', qualityCommands: [],
  }
  const baselineHash = executionBaselineHash(baseline)
  return makeRun({
    acceptanceCriteria: ['feature works'],
    authority: { owner: 'user' },
    baselineHistory: [baseline],
    baseline,
    executionAuthorization: {
      executionBaselineHash: baselineHash,
      effectProfile: { filesystem: 'read-only', quality: 'none', external: 'none' },
    },
    currentStage: 'closeout',
    history: [
      gateRecord({
        gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
        basis: ['baseline approved'], evidenceReviewed: ['plan'], stateUpdate: 'authorize execution',
        executionBaselineHash: baselineHash,
      }),
      gateRecord({
        gate: 'G', stage: 'arbiter', decision: 'pass', nextStage: 'closeout',
        basis: ['verified'], evidenceReviewed: ['report'], stateUpdate: 'move to closeout',
        executionBaselineHash: baselineHash,
      }),
    ],
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

function makeQualityRun(): ConductorRun {
  const binding: QualityCommandBinding = {
    id: QualityCommandId('unit-check'),
    definitionHash: 'a'.repeat(64),
    requiredGates: ['D', 'E'],
  }
  const baseline = {
    scopeVersion: 'scope-v1',
    planVersion: 'plan-v1',
    acceptanceVersion: 'accept-v1',
    allowedPaths: [],
    excludedPaths: [],
    rollbackReference: 'HEAD',
    qualityCommands: [binding],
  }
  const evidenceId = QualityEvidenceId('quality-1')
  return makeRun({
    acceptanceCriteria: ['feature works'],
    sourceBaseline: 'HEAD',
    authority: { owner: 'user' },
    baselineHistory: [baseline],
    baseline,
    executionAuthorization: {
      executionBaselineHash: executionBaselineHash(baseline),
      effectProfile: { filesystem: 'read-only', quality: 'catalog', external: 'none' },
    },
    currentStage: 'auditor',
    history: [
      gateRecord({
        gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
        evidenceReviewed: ['approved plan'], executionBaselineHash: executionBaselineHash(baseline),
      }),
      gateRecord({
        gate: 'D', stage: 'headsman', decision: 'pass', nextStage: 'auditor', evidenceReviewed: [evidenceId],
        executionBaselineHash: executionBaselineHash(baseline),
      }),
    ],
    specialistReports: [{
      run_id: 'CON-2026-0001',
      stage: 'headsman',
      baseline_ref: 'HEAD',
      status: 'ready',
      summary: 'implemented',
      evidence: [{ kind: 'test', reference: 'unit-check', outcome: 'passed' }],
      findings: [],
      assumptions: [],
      blockers: [],
      artifacts: [],
      change_requests: [],
      quality_evidence_ids: [evidenceId],
      recommended_transition: { target: 'conductor', rationale: 'evaluate Gate D' },
      confidence: 'high',
    }],
    qualityExecutions: [{
      evidenceId,
      runId: ConductorRunId('CON-2026-0001'),
      childSessionId: SessionId('quality-child'),
      commandId: binding.id,
      definitionHash: binding.definitionHash,
      executionBaselineHash: executionBaselineHash(baseline),
      gate: 'D',
      cycle: 1,
      policyStage: 'headsman',
      executorStage: 'ralph',
      outcome: 'passed',
      exitCode: 0,
      signal: null,
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:01.000Z',
      stdoutSha256: 'b'.repeat(64),
      stderrSha256: 'c'.repeat(64),
      stdoutTruncated: false,
      stderrTruncated: false,
    }],
  })
}

describe('dsh-conductor persistence', () => {
  it('round-trips a run through the JSON wire format unchanged', () => {
    const run = makeRun({
      currentStage: 'strategist',
      history: [gateRecord({ gate: 'B', stage: 'strategist', decision: 'rework', defectClass: 'plan', nextStage: 'strategist' })],
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
      authority: { owner: 'user', permittedActions: ['delete'], executionPermissions: [] },
    }))).toThrow(/attribution-only/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      baseline: {
        scopeVersion: 'scope-v1',
        planVersion: 'plan-v1',
        acceptanceVersion: 'acceptance-v1',
        allowedPaths: [42],
        excludedPaths: [],
        rollbackReference: 'HEAD',
        qualityCommands: [],
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
        qualityCommands: [],
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
        qualityCommands: [],
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

  it('rejects tampered authorization, bindings, evidence, and private fields', () => {
    const valid = makeQualityRun()
    expect(parseRun(serializeRun(valid))).toEqual(valid)
    expect(() => parseRun(JSON.stringify({
      ...valid,
      authority: { ...valid.authority, executionPermissions: ['invalid'] },
    }))).toThrow(/attribution-only/)
    expect(() => parseRun(serializeRun({
      ...valid,
      baseline: { ...valid.baseline!, qualityCommands: [...valid.baseline!.qualityCommands, valid.baseline!.qualityCommands[0]!] },
    }))).toThrow(/ids must not contain duplicates/)
    expect(() => parseRun(JSON.stringify({
      ...valid,
      qualityExecutions: [{ ...valid.qualityExecutions[0], spillPath: 'private/output.log' }],
    }))).toThrow(/unsupported field spillPath/)
    expect(() => parseRun(serializeRun({
      ...valid,
      qualityExecutions: [{ ...valid.qualityExecutions[0]!, runId: ConductorRunId('CON-2026-0002') }],
    }))).toThrow(/runId must match/)
    expect(() => parseRun(serializeRun({
      ...valid,
      qualityExecutions: [{ ...valid.qualityExecutions[0]!, executionBaselineHash: 'd'.repeat(64) }],
    }))).toThrow(/unknown baseline/)
  })

  it('rejects impossible quality executor ownership, timestamps, and citations', () => {
    const valid = makeQualityRun()
    expect(() => parseRun(serializeRun({
      ...valid,
      qualityExecutions: [{ ...valid.qualityExecutions[0]!, executorStage: 'auditor' }],
    }))).toThrow(/executorStage is outside the policy stage/)
    expect(() => parseRun(serializeRun({
      ...valid,
      qualityExecutions: [{ ...valid.qualityExecutions[0]!, startedAt: 'not-a-time' }],
    }))).toThrow(/must be an ISO timestamp/)
    expect(() => parseRun(serializeRun({
      ...valid,
      qualityExecutions: [{
        ...valid.qualityExecutions[0]!,
        startedAt: '2026-10-10T00:00:02.000Z',
        finishedAt: '2026-10-10T00:00:01.000Z',
      }],
    }))).toThrow(/finished before it started/)
    expect(() => parseRun(serializeRun({
      ...valid,
      specialistReports: [{ ...valid.specialistReports[0]!, quality_evidence_ids: ['unknown'] }],
    }))).toThrow(/references unknown quality evidence/)
  })

  it('rejects a passed quality gate without a ready report that cites its evidence', () => {
    const valid = makeQualityRun()
    expect(() => parseRun(serializeRun({
      ...valid,
      specialistReports: [{ ...valid.specialistReports[0]!, quality_evidence_ids: [] }],
    }))).toThrow(/Gate D pass lacks a matching ready headsman report/)
    expect(() => parseRun(serializeRun({
      ...valid,
      history: valid.history.map(record => record.gate === 'D' ? { ...record, evidenceReviewed: [] } : record),
    }))).toThrow(/Gate D pass lacks fresh evidence/)
  })

  it('preserves historical baselines and evidence when scope rework invalidates the active authorization', () => {
    const reworked = recordGate(makeQualityRun(), {
      decision: 'rework',
      defectClass: 'scope',
      nextStage: 'detective',
      basis: ['scope changed'],
      evidenceReviewed: ['scope review'],
      stateUpdate: 'return to scope discovery',
    })
    expect(reworked.baseline).toBeNull()
    expect(reworked.executionAuthorization).toBeNull()
    expect(reworked.baselineHistory).toHaveLength(1)
    expect(reworked.qualityExecutions).toHaveLength(1)
    expect(parseRun(serializeRun(reworked))).toEqual(reworked)
  })

  it('does not let evidence from an old baseline satisfy a new baseline gate', () => {
    const old = makeQualityRun()
    const newBaseline = {
      ...old.baseline!,
      planVersion: 'plan-v2',
    }
    const newHash = executionBaselineHash(newBaseline)
    const tampered = {
      ...old,
      baselineHistory: [...old.baselineHistory, newBaseline],
      baseline: newBaseline,
      executionAuthorization: {
        executionBaselineHash: newHash,
        effectProfile: { filesystem: 'read-only' as const, quality: 'catalog' as const, external: 'none' as const },
      },
      history: [...old.history,
        gateRecord({
          gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
          evidenceReviewed: ['updated plan'], executionBaselineHash: newHash,
        }),
        {
          ...old.history.find(record => record.gate === 'D')!,
          executionBaselineHash: newHash,
        },
      ],
    }
    expect(() => parseRun(serializeRun(tampered))).toThrow(/Gate D pass lacks fresh evidence/)
  })

  it('rejects a Gate E pass that reuses the Gate D child identity', () => {
    const valid = makeQualityRun()
    const gateDEvidence = valid.qualityExecutions[0]!
    const evidenceId = QualityEvidenceId('quality-e')
    const gateEEvidence = {
      ...gateDEvidence,
      evidenceId,
      gate: 'E' as const,
      policyStage: 'auditor' as const,
      executorStage: 'auditor' as const,
      startedAt: '2026-10-10T00:00:02.000Z',
      finishedAt: '2026-10-10T00:00:03.000Z',
    }
    expect(() => parseRun(serializeRun({
      ...valid,
      currentStage: 'integrator',
      history: [
        ...valid.history,
        gateRecord({
          gate: 'E', stage: 'auditor', decision: 'pass', nextStage: 'integrator',
          evidenceReviewed: [evidenceId], executionBaselineHash: executionBaselineHash(valid.baseline!),
        }),
      ],
      specialistReports: [
        ...valid.specialistReports,
        { ...valid.specialistReports[0]!, stage: 'auditor', summary: 'independently verified', quality_evidence_ids: [evidenceId] },
      ],
      qualityExecutions: [...valid.qualityExecutions, gateEEvidence],
    }))).toThrow(/Gate E pass lacks independent single-child Auditor evidence/)
  })

  it('rejects invalid durable gate applicability metadata', () => {
    const valid = makeQualityRun()
    expect(() => parseRun(JSON.stringify({
      ...valid,
      baseline: {
        ...valid.baseline,
        qualityCommands: [{ ...valid.baseline!.qualityCommands[0], requiredGates: ['F'] }],
      },
    }))).toThrow(/requiredGates must contain distinct D\/E gates/)
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
      ...valid, closeout: { ...valid.closeout!, outcome_evidence: [] },
    }))).toThrow(/outcome_evidence must not be empty/)
  })

  it('rejects pre-versioned records without migration', () => {
    const { recordFormatVersion: _omitted, ...legacy } = makeRun()
    expect(() => parseRun(JSON.stringify(legacy))).toThrow(/format undefined is unsupported/)
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
})
