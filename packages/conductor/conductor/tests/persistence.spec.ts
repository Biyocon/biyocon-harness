import { implementationAdmission } from './intake-fixtures.ts'
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
import type { ConductorRun, EvaluatedGateRecord as GateRecord, QualityCommandBinding } from '../src/index.ts'

function makeRun(overrides: Partial<ConductorRun> = {}): ConductorRun {
  return {
    recordFormatVersion: 3,
    admission: implementationAdmission(), repairReturns: [], analysisReports: [], reportCandidates: [],
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
    budget: { maxReworkPerGate: 3, maxRalphRounds: 0 },
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
  return { kind: 'evaluated', basis: [], evidenceReviewed: [], stateUpdate: '', ...partial }
}

function scopeAndPlan(): GateRecord[] {
  return [
    gateRecord({ gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'strategist' }),
    gateRecord({ gate: 'B', stage: 'strategist', decision: 'pass', nextStage: 'devils-advocate' }),
  ]
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
      ...scopeAndPlan(),
      gateRecord({ kind: 'evaluated',
        gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
        basis: ['baseline approved'], evidenceReviewed: ['plan'], stateUpdate: 'authorize execution',
        executionBaselineHash: baselineHash,
      }),
      ...([
        ['D', 'headsman', 'auditor'], ['E', 'auditor', 'integrator'], ['F', 'integrator', 'arbiter'],
      ] as const).map(([gate, stage, nextStage]) => gateRecord({ gate, stage, decision: 'pass', nextStage,
        executionBaselineHash: baselineHash })),
      gateRecord({ kind: 'evaluated',
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
      ...scopeAndPlan(),
      gateRecord({ kind: 'evaluated',
        gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
        evidenceReviewed: ['approved plan'], executionBaselineHash: executionBaselineHash(baseline),
      }),
      gateRecord({ kind: 'evaluated',
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
      qualityCommands: [],
    },
    quality_evidence_ids: [],
    recommended_transition: { target: 'conductor', rationale: 'evaluate' },
    confidence: 'high',
  }
}

describe('dsh-conductor persistence', () => {
  it('rejects version 1 and removed budget fields instead of migrating them', () => {
    expect(() => parseRun(JSON.stringify({ ...makeRun(), recordFormatVersion: 1 })))
      .toThrow(/format 1 is unsupported; expected 3/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(), budget: { maxReworkPerGate: 2, maxReworkCycles: 3, maxRalphRounds: 0 },
    }))).toThrow(/budget contains unsupported fields/)
  })

  it('round-trips same-role report repairs and rejects a forged third rework at a gate', () => {
    let run = makeRun({ budget: { maxReworkPerGate: 2, maxRalphRounds: 0 } })
    const verdict = {
      decision: 'rework' as const, defectClass: 'report' as const, nextStage: 'detective' as const,
      basis: ['malformed report'], evidenceReviewed: [], stateUpdate: 'repair Detective report',
    }
    run = recordGate(recordGate(run, verdict), verdict)
    expect(parseRun(serializeRun(run))).toEqual(run)
    expect(() => parseRun(JSON.stringify({ ...run, history: [...run.history, run.history[0]] })))
      .toThrow(/exceeds its per-gate rework budget/)
  })

  it('rejects malformed baseline history, bindings, and host authorizations', () => {
    const valid = makeQualityRun()
    const baseline = valid.baseline!
    const binding = baseline.qualityCommands[0]!
    const newer = { ...baseline, planVersion: 'plan-new' }
    const newHash = executionBaselineHash(newer)
    const updated = {
      ...valid, baseline: newer, baselineHistory: [baseline, newer],
      executionAuthorization: { ...valid.executionAuthorization!, executionBaselineHash: newHash },
    }
    const invalid: Array<[unknown, RegExp]> = [
      [{ ...valid, baselineHistory: null }, /baselineHistory must be an array/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: null } }, /qualityCommands must be an array/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: [{ ...binding, argv: ['unsafe'] }] } }, /unsupported field argv/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: [{ ...binding, definitionHash: 'bad' }] } }, /definitionHash must be SHA-256/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: [{ ...binding, requiredGates: null }] } }, /requiredGates/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: [{ ...binding, requiredGates: [] }] } }, /requiredGates/],
      [{ ...valid, baseline: { ...baseline, qualityCommands: [{ ...binding, requiredGates: ['D', 'D'] }] } }, /requiredGates/],
      [{ ...valid, baseline: newer }, /latest baselineHistory/],
      [{ ...valid, baselineHistory: [baseline, newer] }, /latest baselineHistory/],
      [{ ...valid, executionAuthorization: null }, /requires executionAuthorization/],
      [{ ...valid, baseline: null }, /requires an active baseline/],
      [{ ...valid, executionAuthorization: { ...valid.executionAuthorization, extra: true } }, /unsupported field extra/],
      [{ ...valid, executionAuthorization: { ...valid.executionAuthorization, executionBaselineHash: 'f'.repeat(64) } }, /does not match active baseline/],
      [{ ...valid, history: valid.history.map(record => record.gate === 'C' ? { ...record, executionBaselineHash: 'bad' } : record) }, /unknown execution baseline/],
      [{ ...valid, history: valid.history.map(record => record.gate === 'C' ? { ...record, executionBaselineHash: 'f'.repeat(64) } : record) }, /unknown execution baseline/],
      [{ ...makeRun(), history: [gateRecord({ kind: 'evaluated',
        gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'strategist', executionBaselineHash: 'a'.repeat(64),
      })] }, /cannot carry executionBaselineHash/],
      [{ ...valid, history: [] }, /baselineHistory must exactly follow/],
      [{ ...updated, history: [...valid.history, gateRecord({ kind: 'evaluated',
        gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman', executionBaselineHash: newHash,
      }), valid.history.find(gate => gate.gate === 'D')!] }, /does not use the latest Gate C baseline/],
      [{ ...valid, baseline: null, executionAuthorization: null }, /active baseline does not match documented/],
    ]
    for (const effectProfile of [
      { ...valid.executionAuthorization!.effectProfile, extra: true },
      { ...valid.executionAuthorization!.effectProfile, filesystem: 'workspace-write' },
      { ...valid.executionAuthorization!.effectProfile, quality: 'none' },
      { ...valid.executionAuthorization!.effectProfile, external: 'publish' },
    ]) {
      invalid.push([{ ...valid, executionAuthorization: { ...valid.executionAuthorization, effectProfile } }, /invalid effect profile/])
    }
    for (const [record, message] of invalid) {
      expect(() => parseRun(JSON.stringify(record))).toThrow(message)
    }
  })

  it('validates every durable execution outcome field and its gate attempt', () => {
    const valid = makeQualityRun()
    const evidence = valid.qualityExecutions[0]!
    const invalid: Array<[Record<string, unknown>, RegExp]> = [
      [{ definitionHash: 'bad' }, /definitionHash must be SHA-256/],
      [{ commandId: 'unknown' }, /does not match a baseline binding/],
      [{ definitionHash: 'f'.repeat(64) }, /does not match a baseline binding/],
      [{ gate: 'F' }, /gate is invalid/],
      [{ cycle: 0 }, /cycle is invalid/],
      [{ cycle: 1.5 }, /cycle is invalid/],
      [{ cycle: 2 }, /no documented gate attempt/],
      [{ policyStage: 'integrator' }, /policyStage is invalid/],
      [{ executorStage: 'integrator' }, /executorStage is invalid/],
      [{ policyStage: 'auditor' }, /stage does not match gate/],
      [{ outcome: 'unknown' }, /outcome is invalid/],
      [{ outcome: 'failed' }, /failure is invalid/],
      [{ outcome: 'failed', failure: 'unknown' }, /failure is invalid/],
      [{ failure: 'timeout' }, /passed with a failure/],
      [{ exitCode: '' }, /exitCode is invalid/],
      [{ signal: 1 }, /signal is invalid/],
      [{ exitCode: 2 }, /passed without a clean exit/],
      [{ signal: 'SIGTERM' }, /passed without a clean exit/],
      [{ outcome: 'failed', failure: 'signal', signal: null }, /requires a signal/],
      [{ outcome: 'failed', failure: 'signal', signal: '' }, /requires a signal/],
      [{ stdoutSha256: 'bad' }, /stdoutSha256 must be SHA-256/],
      [{ stderrSha256: 'bad' }, /stderrSha256 must be SHA-256/],
      [{ stdoutTruncated: 1 }, /truncation flags/],
      [{ stderrTruncated: 1 }, /truncation flags/],
    ]
    for (const [patch, message] of invalid) {
      expect(() => parseRun(JSON.stringify({ ...valid, qualityExecutions: [{ ...evidence, ...patch }] }))).toThrow(message)
    }
    expect(() => parseRun(JSON.stringify({ ...valid, qualityExecutions: null }))).toThrow(/qualityExecutions must be an array/)
    expect(() => parseRun(JSON.stringify({ ...valid, qualityExecutions: [evidence, evidence] }))).toThrow(/ids must not contain duplicates/)
    expect(() => parseRun(JSON.stringify({
      ...valid, history: [...valid.history, gateRecord({ kind: 'evaluated',
        gate: 'E', stage: 'auditor', decision: 'escalate', executionBaselineHash: executionBaselineHash(valid.baseline!),
      })], qualityExecutions: [{ ...evidence, gate: 'E', policyStage: 'headsman' }],
    }))).toThrow(/stage does not match gate/)
  })

  it('round-trips a failed gate attempt and plan rework without losing historical evidence', () => {
    const valid = makeQualityRun()
    const failed = {
      ...valid, currentStage: 'headsman' as const, status: 'escalated' as const,
      history: valid.history.map((record) => {
        if (record.kind !== 'evaluated' || record.gate !== 'D') return record
        const { nextStage: _nextStage, ...attempt } = record
        return { ...attempt, decision: 'escalate' as const }
      }),
      qualityExecutions: valid.qualityExecutions.map(record => ({
        ...record, outcome: 'failed' as const, failure: 'signal' as const, exitCode: null, signal: 'SIGTERM',
      })),
    }
    expect(parseRun(serializeRun(failed))).toEqual(failed)
    const reworked = recordGate(valid, {
      decision: 'rework', defectClass: 'plan', nextStage: 'strategist',
      basis: ['revise plan'], evidenceReviewed: ['review'], stateUpdate: 'replan',
    })
    expect(parseRun(serializeRun(reworked))).toEqual(reworked)
  })

  it('round-trips a run through the JSON wire format unchanged', () => {
    const run = makeRun({
      currentStage: 'strategist',
      history: [scopeAndPlan()[0]!, gateRecord({ kind: 'evaluated', gate: 'B', stage: 'strategist', decision: 'rework', defectClass: 'plan', nextStage: 'strategist' })],
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
      history: [{ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'bogus', basis: [], evidenceReviewed: [], stateUpdate: '' }],
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
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'auditor', decision: 'pass', nextStage: 'strategist' })],
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
        gateRecord({ kind: 'evaluated',
          gate: 'C', stage: 'devils-advocate', decision: 'pass', nextStage: 'headsman',
          evidenceReviewed: ['updated plan'], executionBaselineHash: newHash,
        }),
        {
          ...old.history.find((record): record is GateRecord => record.kind === 'evaluated' && record.gate === 'D')!,
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
    const verified: ConductorRun = {
      ...valid,
      currentStage: 'integrator',
      history: [
        ...valid.history,
        gateRecord({ kind: 'evaluated',
          gate: 'E', stage: 'auditor', decision: 'pass', nextStage: 'integrator',
          evidenceReviewed: [evidenceId], executionBaselineHash: executionBaselineHash(valid.baseline!),
        }),
      ],
      specialistReports: [
        ...valid.specialistReports,
        { ...valid.specialistReports[0]!, stage: 'auditor', summary: 'independently verified', quality_evidence_ids: [evidenceId] },
      ],
      qualityExecutions: [...valid.qualityExecutions, gateEEvidence],
    }
    expect(() => parseRun(serializeRun(verified))).toThrow(/Gate E pass lacks independent single-child Auditor evidence/)
    verified.qualityExecutions[1] = { ...gateEEvidence, childSessionId: SessionId('independent-auditor') }
    expect(parseRun(serializeRun(verified))).toEqual(verified)
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
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'headsman' })],
    }))).toThrow(/successor does not match/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun({ status: 'rework', currentStage: 'headsman' }),
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'rework', nextStage: 'headsman' })],
    }))).toThrow(/rework has invalid defectClass/)
    expect(() => parseRun(JSON.stringify({
      ...makeRun(),
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'abort' })],
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
    expect(() => { validateResumable(makeRun({ currentStage: 'auditor' })) }).toThrow(/complete gate history/)
  })

  it('rejects a run whose stage does not match its last documented gate', () => {
    const run = makeRun({
      currentStage: 'auditor',
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'strategist' })],
    })
    expect(() => { validateResumable(run) }).toThrow(/complete gate history/)
  })

  it('rejects a run whose documented history skips a stage', () => {
    const run = makeRun({
      currentStage: 'devils-advocate',
      history: [gateRecord({ kind: 'evaluated', gate: 'B', stage: 'strategist', decision: 'pass', nextStage: 'devils-advocate' })],
    })
    expect(() => { validateResumable(run) }).toThrow(/does not follow its admitted causal route/)
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
      [{ ...makeRun(), authority: { owner: '' } }, /authority.owner/],
      [{ ...makeRun(), authority: { owner: 'user', permittedActions: ['read', 'read'] } }, /attribution-only/],
      [{ ...makeRun(), constraints: [' '] }, /constraints/],
      [{ ...makeRun(), budget: { maxReworkPerGate: 0, maxRalphRounds: 0 } }, /maxReworkPerGate/],
      [{ ...makeRun(), budget: { maxReworkPerGate: 1, maxRalphRounds: -1 } }, /maxRalphRounds/],
      [{ ...makeRun(), baseline: [] }, /baseline must be an object/],
      [{ ...makeRun(), baseline: {
        scopeVersion: 1, planVersion: 'p', acceptanceVersion: 'a',
        allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD',
      } }, /baseline.scopeVersion/],
      [{ ...makeRun(), history: null }, /history must be an array/],
      [{ ...makeRun(), history: [null] }, /history entry must be an object/],
      [{ ...makeRun(), history: [gateRecord({ kind: 'evaluated', gate: 'bogus' as never, stage: 'detective', decision: 'pass' })] }, /invalid gate/],
      [{ ...makeRun(), history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'bogus' as never, decision: 'pass' })] }, /invalid stage/],
      [{ ...makeRun(), history: [gateRecord({ kind: 'evaluated',
        gate: 'A', stage: 'detective', decision: 'rework', defectClass: 'bogus' as never,
      })] }, /invalid defectClass/],
      [{ ...makeRun(), history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass', nextStage: 'bogus' as never })] }, /invalid nextStage/],
      [{ ...makeRun(), history: [{ ...gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass' }), basis: [1] }] }, /history.basis/],
      [{ ...makeRun(), history: [{ ...gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass' }), evidenceReviewed: [1] }] }, /history.evidenceReviewed/],
      [{ ...makeRun(), history: [{ ...gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'pass' }), stateUpdate: 1 }] }, /history.stateUpdate/],
      [{ ...makeRun(), status: 'aborted', history: [gateRecord({ kind: 'evaluated',
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

  it('rejects a record that was not admitted to its first stage', () => {
    expect(() => { validateResumable(makeRun({ currentStage: 'intake' })) }).toThrow(/complete gate history/)
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
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'escalate' })],
    })
    expect(parseRun(serializeRun(escalated))).toEqual(escalated)

    const sameStage = makeRun({
      currentStage: 'detective',
      status: 'rework',
      history: [gateRecord({ kind: 'evaluated', gate: 'A', stage: 'detective', decision: 'rework', defectClass: 'report', nextStage: 'detective' })],
    })
    expect(() => { validateResumable(sameStage) }).not.toThrow()
  })
})
