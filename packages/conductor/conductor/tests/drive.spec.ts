import { implementationAdmission } from './intake-fixtures.ts'
import { describe, expect, it } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  ConductorRunId,
  QualityCommandId,
  QualityEvidenceId,
  SpecialistExecutionFailure,
  admitIntake,
  createRun,
  parseRun,
  serializeRun,
  drive,
  executionBaselineHash,
} from '../src/index.ts'
import type {
  ConductorDispatcher,
  ConductorRun,
  ConductorStage,
  DecisionRecord,
  SpecialistEnvelope,
  QualityCommandBinding,
  QualityExecutionRecord,
} from '../src/index.ts'

const QUALITY_BINDING: QualityCommandBinding = {
  id: QualityCommandId('unit-check'),
  definitionHash: 'a'.repeat(64),
  requiredGates: ['D', 'E'],
}

function makeRun(overrides: Partial<ConductorRun> = {}): ConductorRun {
  return {
    recordFormatVersion: 3,
    admission: implementationAdmission(), repairReturns: [], analysisReports: [], reportCandidates: [],
    runId: ConductorRunId('CON-2026-0001'),
    objective: 'ship the feature',
    scope: [],
    inputArtifacts: [],
    allowedPaths: ['packages/conductor'],
    excludedPaths: [],
    sourceBaseline: null,
    authority: { owner: 'user' },
    constraints: [],
    acceptanceCriteria: ['feature works'],
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

function authorize(
  _run: Parameters<ConductorDispatcher['authorizeExecution']>[0],
  baseline: Parameters<ConductorDispatcher['authorizeExecution']>[1],
) {
  return Promise.resolve({
    executionBaselineHash: executionBaselineHash(baseline),
    effectProfile: {
      filesystem: 'workspace-write' as const,
      quality: baseline.qualityCommands.length === 0 ? 'none' as const : 'catalog' as const,
      external: 'none' as const,
    },
  })
}

function makeEnvelope(stage: ConductorStage, overrides: Partial<SpecialistEnvelope> = {}): SpecialistEnvelope {
  return {
    run_id: 'CON-2026-0001',
    stage,
    baseline_ref: 'HEAD',
    ...stage === 'detective' ? { source_baseline: 'HEAD' } : {},
    status: 'ready',
    summary: 'done',
    evidence: [{ kind: 'test', reference: `${stage}-check`, outcome: 'passed' }],
    findings: [],
    assumptions: [],
    blockers: [],
    artifacts: [],
    change_requests: [],
    quality_evidence_ids: [],
    recommended_transition: { target: 'conductor', rationale: 'evaluate' },
    confidence: 'high',
    ...stage === 'devils-advocate' ? {
      execution_baseline: {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommands: [],
      },
    } : {},
    ...overrides,
  }
}

function makeDecision(decision: 'go' | 'no-go' = 'go'): DecisionRecord {
  return {
    run_id: 'CON-2026-0001',
    decision,
    basis: ['evidence meets criteria'],
    evidence_reviewed: ['delivery package'],
    conditions: [],
    open_risks: [],
    required_follow_up: [],
  }
}

describe('implementation entry source provenance', () => {
  it.each([
    ['strategist', undefined, 'detective'], ['devils-advocate', undefined, 'detective'],
    ['strategist', 'HEAD', 'strategist'], ['devils-advocate', 'HEAD', 'devils-advocate'],
  ] as const)('admits %s with baseline %s through %s', async (entry, sourceBaseline, firstStage) => {
    const initial = makeRun()
    const run = createRun(initial.runId, {
      admission: admitIntake({ purpose: 'implementation', entry, rationale: 'Review the supplied implementation plan.',
        scopeSources: ['current-request'], planSources: ['current-request'], plan: ['Review and implement the supplied scope.'],
      }, initial.admission.materials),
      objective: initial.objective, authority: initial.authority,
      scope: ['the supplied implementation'], acceptanceCriteria: initial.acceptanceCriteria,
      ...sourceBaseline === undefined ? {} : { sourceBaseline },
    })
    expect(run.sourceBaseline).toBe(sourceBaseline ?? null)
    const called: ConductorStage[] = []
    const result = await drive(run, {
      authorizeExecution: () => { throw new Error('No approval before the source is assessed') },
      dispatchArbiter: () => { throw new Error('No decision before the source is assessed') },
      dispatchSpecialist(stage, current) {
        called.push(stage)
        expect(current.sourceBaseline).toBe(sourceBaseline ?? null)
        return Promise.resolve(makeEnvelope(stage, { status: 'blocked', blockers: ['Stop after source assessment.'] }))
      },
    }, (checkpoint) => { expect(parseRun(serializeRun(checkpoint))).toEqual(checkpoint); return Promise.resolve() })
    expect(called).toEqual([firstStage])
    const repair = result.run.history.find(gate => gate.kind === 'evaluated' && gate.origin === 'intake-validation')
    if (sourceBaseline === undefined) expect(repair).toMatchObject({ decision: 'rework', nextStage: 'detective', defectClass: 'scope' })
    else expect(repair).toBeUndefined()
  })
})

function dispatcherFor(envelope: unknown, decision: unknown = makeDecision()): ConductorDispatcher {
  return {
    authorizeExecution: authorize,
    async dispatchSpecialist() { return envelope },
    async dispatchArbiter() { return decision },
  }
}

describe('dsh-conductor drive', () => {
  it.each([
    new Error('specialist transport failed'),
    new SpecialistExecutionFailure('specialist transport failed', 'detective', true),
  ])('propagates execution faults without inventing a report or a gate verdict: %s', async (failure) => {
    const run = makeRun()
    const checkpoints: ConductorRun[] = []
    await expect(drive(run, {
      authorizeExecution: authorize,
      async dispatchSpecialist() { throw failure },
      async dispatchArbiter() { return makeDecision() },
    }, async (checkpoint) => { checkpoints.push(checkpoint) })).rejects.toBe(failure)
    expect(run.history).toEqual([])
    expect(run.specialistReports).toEqual([])
    expect(checkpoints).toEqual([])
  })

  it.each(['detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'integrator'] as const)(
    'repairs malformed %s output at the same role and continues after correction', async (target) => {
      let repairs = 0
      const seen: ConductorStage[] = []
      const result = await drive(makeRun(), {
        authorizeExecution: authorize,
        async dispatchSpecialist(stage) {
          seen.push(stage)
          if (stage === target && repairs++ === 0) {
            return makeEnvelope(stage, { findings: [{ id: 'broken' }] as never })
          }
          return makeEnvelope(stage, { findings: [{
            id: 'verified', severity: 'low', description: 'Report corrected.', impact: 'Safe to evaluate.',
          }] })
        },
        async dispatchArbiter() { return makeDecision() },
      })
      expect(result.kind).toBe('decision')
      expect(seen.filter(stage => stage === target)).toHaveLength(2)
      expect(result.run.history.find(record => record.decision === 'rework')).toMatchObject({
        stage: target, defectClass: 'report', nextStage: target,
      })
    },
  )

  it('repairs an invalid Gate C baseline before asking for approval without changing owner paths', async () => {
    let attempts = 0
    let approvals = 0
    const run = makeRun()
    const result = await drive(run, {
      async authorizeExecution(current, baseline) {
        approvals += 1
        expect(baseline.allowedPaths).toEqual(run.allowedPaths)
        expect(baseline.excludedPaths).toEqual(run.excludedPaths)
        return authorize(current, baseline)
      },
      async dispatchSpecialist(stage) {
        const envelope = makeEnvelope(stage)
        if (stage === 'devils-advocate' && attempts++ === 0) {
          envelope.execution_baseline!.allowedPaths = ['unauthorized-root']
        }
        return envelope
      },
      async dispatchArbiter() { return makeDecision() },
    })
    expect(result.kind).toBe('decision')
    expect(result.run.history.filter(record => record.gate === 'C').map(record => record.decision)).toEqual(['rework', 'pass'])
    expect(result.run.specialistReports.filter(report => report.stage === 'devils-advocate')).toHaveLength(1)
    expect(approvals).toBe(1)
    expect(run.allowedPaths).toEqual(['packages/conductor'])
  })

  it('retries malformed Arbiter output but immediately escalates cross-run authority claims', async () => {
    for (const forged of [false, true]) {
      let attempts = 0
      const result = await drive(makeRun(), {
        authorizeExecution: authorize,
        async dispatchSpecialist(stage) { return makeEnvelope(stage) },
        async dispatchArbiter() {
          attempts += 1
          if (attempts === 1) return forged ? { ...makeDecision(), run_id: 'CON-2026-9999' } : null
          return makeDecision()
        },
      })
      expect(result.kind).toBe(forged ? 'blocked' : 'decision')
      expect(attempts).toBe(forged ? 1 : 2)
      expect(result.run.history.filter(record => record.gate === 'G').map(record => record.decision))
        .toEqual(forged ? ['escalate'] : ['rework', 'pass'])
    }
  })

  it('drives through every gate to a GO decision and closeout', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) { return makeEnvelope(stage) },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('decision')
    if (outcome.kind !== 'decision') throw new Error('expected decision')
    expect(outcome.decision.decision).toBe('go')
    expect(outcome.run.currentStage).toBe('closeout')
    expect(outcome.run.status).toBe('awaiting_authorization')
    expect(outcome.run.sourceBaseline).toBe('HEAD')
    expect(outcome.run.decision).toEqual(outcome.decision)
    expect(outcome.run.history.map(record => record.gate)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
    expect(outcome.run.specialistReports.map(report => report.stage)).toEqual([
      'detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'integrator',
    ])
  })

  it('does not turn a ready self-report into a gate pass without evidence', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) { return makeEnvelope(stage, { evidence: [] }) },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun(), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.blocker).toMatch(/fresh evidence/)
      expect(outcome.run.history.at(-1)?.decision).toBe('escalate')
      expect(outcome.run.specialistReports).toHaveLength(1)
    }
  })

  it('rejects a ready Detective that did not establish the missing source baseline', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        const envelope = makeEnvelope(stage)
        if (stage !== 'detective') return envelope
        const { source_baseline: _omitted, ...withoutSourceBaseline } = envelope
        return withoutSourceBaseline
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun(), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(/establish source_baseline/)
  })

  it('rejects a Gate C baseline that widens the owner-authorized paths', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        if (stage !== 'devils-advocate') return makeEnvelope(stage)
        return makeEnvelope(stage, {
          execution_baseline: {
            scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
            allowedPaths: ['.'], excludedPaths: [], rollbackReference: 'HEAD',
            qualityCommands: [],
          },
        })
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun(), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(/owner-authorized run paths/)
  })

  it('blocks before Headsman when the host rejects Gate C execution authorization', async () => {
    const dispatched: ConductorStage[] = []
    const dispatcher: ConductorDispatcher = {
      async authorizeExecution() { return null },
      async dispatchSpecialist(stage) {
        dispatched.push(stage)
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun(), dispatcher)
    expect(outcome.kind).toBe('blocked')
    expect(dispatched).toEqual(['detective', 'strategist', 'devils-advocate'])
    expect(outcome.run.baseline).toBeNull()
    expect(outcome.run.executionAuthorization).toBeNull()
    expect(outcome.run.history.at(-1)).toMatchObject({ kind: 'evaluated', gate: 'C', decision: 'escalate' })
  })

  it('turns unavailable or mismatched Gate C authorization into a controlled blocker', async () => {
    for (const authorizeExecution of [
      () => Promise.reject(new Error('approval service offline')),
      // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- plugin dispatchers may reject with a non-Error value.
      () => Promise.reject('approval transport unavailable'),
      () => Promise.resolve({
        executionBaselineHash: 'f'.repeat(64),
        effectProfile: { filesystem: 'workspace-write' as const, quality: 'none' as const, external: 'none' as const },
      }),
      async (_run: ConductorRun, baseline: Parameters<ConductorDispatcher['authorizeExecution']>[1]) => ({
        executionBaselineHash: executionBaselineHash(baseline),
        effectProfile: { filesystem: 'read-only' as const, quality: 'none' as const, external: 'none' as const },
      }),
      async (_run: ConductorRun, baseline: Parameters<ConductorDispatcher['authorizeExecution']>[1]) => ({
        executionBaselineHash: executionBaselineHash(baseline),
        effectProfile: { filesystem: 'workspace-write' as const, quality: 'catalog' as const, external: 'none' as const },
      }),
    ]) {
      const outcome = await drive(makeRun(), {
        authorizeExecution,
        async dispatchSpecialist(stage) { return makeEnvelope(stage) },
        async dispatchArbiter() { return makeDecision('go') },
      })
      expect(outcome.kind).toBe('blocked')
      expect(outcome.run.history.at(-1)).toMatchObject({ kind: 'evaluated', gate: 'C', decision: 'escalate' })
      expect(outcome.run.baseline).toBeNull()
    }
  })

  it('routes an auditor rework back to headsman and continues', async () => {
    let auditorCalls = 0
    const dispatched: ConductorStage[] = []
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        dispatched.push(stage)
        if (stage === 'auditor') {
          auditorCalls += 1
          if (auditorCalls === 1) return makeEnvelope(stage, { status: 'rework' })
        }
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('decision')
    expect(dispatched).toEqual([
      'detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'headsman', 'auditor', 'integrator',
    ])
    const run = outcome.kind === 'decision' ? outcome.run : undefined
    expect(run?.history.filter(record => record.decision === 'rework')).toHaveLength(1)
  })

  it('routes a scope rework from the auditor to detective', async () => {
    const dispatched: ConductorStage[] = []
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        dispatched.push(stage)
        if (stage === 'auditor') {
          return makeEnvelope(stage, {
            status: 'rework',
            change_requests: [{ target: 'scope', reason: 'scope was misunderstood', impact: 're-scope' }],
          })
        }
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    const auditor = dispatched.indexOf('auditor')
    expect(dispatched[auditor + 1]).toBe('detective')
  })

  it('parks a blocked specialist result for the owner', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        if (stage === 'detective') return makeEnvelope(stage, { status: 'blocked', blockers: ['missing mandate'] })
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.run.status).toBe('escalated')
      expect(outcome.run.history.at(-1)?.decision).toBe('escalate')
    }
  })

  it('rejects a malformed envelope as a blocker, not a pass', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist() {
        return {
          run_id: 'wrong-id', stage: 'detective', status: 'ready', summary: '',
          baseline_ref: 'HEAD',
          evidence: [], findings: [], assumptions: [], blockers: [], artifacts: [], change_requests: [],
          recommended_transition: { target: 'strategist', rationale: '' }, confidence: 'high',
        }
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.blocker).toMatch(/run_id|stage|summary/)
    }
  })

  it('escalates an authority change request from a specialist', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        if (stage === 'headsman') {
          return makeEnvelope(stage, {
            status: 'rework',
            change_requests: [{ target: 'authority', reason: 'needs write access', impact: 'blocked' }],
          })
        }
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toContain('authority change')
  })

  it('escalates an arbiter NO-GO to the owner', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) { return makeEnvelope(stage) },
      async dispatchArbiter() { return makeDecision('no-go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.blocker).toContain('NO-GO')
      expect(outcome.run.status).toBe('escalated')
    }
  })

  it('rejects an Arbiter GO whose basis is blank', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) { return makeEnvelope(stage) },
      async dispatchArbiter() { return { ...makeDecision('go'), basis: [''] } },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.blocker).toMatch(/basis.*non-empty normalized strings/)
      expect(outcome.run.history.at(-1)?.decision).toBe('escalate')
    }
  })

  it('rejects an Arbiter GO whose reviewed evidence is blank', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) { return makeEnvelope(stage) },
      async dispatchArbiter() { return { ...makeDecision('go'), evidence_reviewed: [''] } },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective' }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.blocker).toMatch(/evidence_reviewed.*non-empty normalized strings/)
      expect(outcome.run.history.at(-1)?.decision).toBe('escalate')
    }
  })

  it('escalates once the rework budget is exhausted', async () => {
    const dispatcher: ConductorDispatcher = {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        if (stage === 'auditor') return makeEnvelope(stage, { status: 'rework' })
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision('go') },
    }
    const outcome = await drive(makeRun({ currentStage: 'detective', budget: { maxReworkPerGate: 1, maxRalphRounds: 0 } }), dispatcher)
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') {
      expect(outcome.run.status).toBe('escalated')
      expect(outcome.run.history.filter(record => record.decision === 'rework')).toHaveLength(1)
      expect(outcome.run.history.at(-1)?.decision).toBe('escalate')
    }
  })

  it('requires fresh host-owned Gate D quality evidence for every required binding', async () => {
    const baseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [QUALITY_BINDING],
    }
    const run = makeRun({
      currentStage: 'headsman',
      sourceBaseline: 'HEAD',
      baseline,
      baselineHistory: [baseline],
      executionAuthorization: {
        executionBaselineHash: executionBaselineHash(baseline),
        effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' },
      },
    })
    const envelope = makeEnvelope('headsman', { quality_evidence_ids: [] })
    const outcome = await drive(run, {
      authorizeExecution: authorize,
      async dispatchSpecialist() {
        return { envelope, qualityExecutions: [], requiredQualityCommands: [QUALITY_BINDING] }
      },
      async dispatchArbiter() { return makeDecision() },
    })
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(/fresh passing quality evidence/)
  })

  it('checkpoints completed quality evidence before rejecting a malformed specialist envelope', async () => {
    const baseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [QUALITY_BINDING],
    }
    const evidenceId = QualityEvidenceId('quality-before-malformed-envelope')
    const record: QualityExecutionRecord = {
      evidenceId,
      runId: ConductorRunId('CON-2026-0001'),
      childSessionId: SessionId('child-malformed'),
      commandId: QUALITY_BINDING.id,
      definitionHash: QUALITY_BINDING.definitionHash,
      executionBaselineHash: executionBaselineHash(baseline),
      gate: 'D',
      cycle: 1,
      policyStage: 'headsman',
      executorStage: 'headsman',
      outcome: 'passed',
      exitCode: 0,
      signal: null,
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:01.000Z',
      stdoutSha256: 'b'.repeat(64),
      stderrSha256: 'c'.repeat(64),
      stdoutTruncated: false,
      stderrTruncated: false,
    }
    const checkpoints: ConductorRun[] = []
    const outcome = await drive(makeRun({
      currentStage: 'headsman', sourceBaseline: 'HEAD', baseline,
      baselineHistory: [baseline],
      executionAuthorization: {
        executionBaselineHash: executionBaselineHash(baseline),
        effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' },
      },
    }), {
      authorizeExecution: authorize,
      async dispatchSpecialist() {
        return {
          envelope: { ...makeEnvelope('headsman'), stage: 'auditor' },
          qualityExecutions: [record],
          requiredQualityCommands: [QUALITY_BINDING],
        }
      },
      async dispatchArbiter() { return makeDecision() },
    }, async (run) => { checkpoints.push(structuredClone(run)) })
    expect(outcome.kind).toBe('blocked')
    expect(outcome.run.qualityExecutions).toEqual([record])
    expect(checkpoints.at(-1)?.qualityExecutions).toEqual([record])
  })

  it('retains host records but rejects unknown and duplicate dispatch-local evidence ids before report persistence', async () => {
    const baseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [QUALITY_BINDING],
    }
    const evidenceId = QualityEvidenceId('dispatch-evidence')
    const record: QualityExecutionRecord = {
      evidenceId,
      runId: ConductorRunId('CON-2026-0001'),
      childSessionId: SessionId('dispatch-child'),
      commandId: QUALITY_BINDING.id,
      definitionHash: QUALITY_BINDING.definitionHash,
      executionBaselineHash: executionBaselineHash(baseline),
      gate: 'D', cycle: 1, policyStage: 'headsman', executorStage: 'headsman', outcome: 'passed',
      exitCode: 0, signal: null,
      startedAt: '2026-10-10T00:00:00.000Z', finishedAt: '2026-10-10T00:00:01.000Z',
      stdoutSha256: 'b'.repeat(64), stderrSha256: 'c'.repeat(64),
      stdoutTruncated: false, stderrTruncated: false,
    }
    for (const { cited, records, previous } of [
      { cited: ['unknown'], records: [record], previous: [] },
      { cited: [evidenceId, evidenceId], records: [record], previous: [] },
      { cited: [evidenceId], records: [record, record], previous: [] },
      { cited: [evidenceId], records: [record], previous: [record] },
    ]) {
      const outcome = await drive(makeRun({
        currentStage: 'headsman', sourceBaseline: 'HEAD', baseline, baselineHistory: [baseline],
        qualityExecutions: previous,
        executionAuthorization: {
          executionBaselineHash: executionBaselineHash(baseline),
          effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' },
        },
      }), {
        authorizeExecution: authorize,
        async dispatchSpecialist() {
          return {
            envelope: makeEnvelope('headsman', { quality_evidence_ids: cited }),
            qualityExecutions: records,
            requiredQualityCommands: [QUALITY_BINDING],
          }
        },
        async dispatchArbiter() { return makeDecision() },
      })
      expect(outcome.kind).toBe('blocked')
      expect(outcome.run.qualityExecutions).toEqual([...previous, ...records])
      expect(outcome.run.specialistReports).toEqual([])
    }
  })

  it('accepts matching Gate D evidence but cannot reuse it for Gate E', async () => {
    const baseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['packages/conductor'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [QUALITY_BINDING],
    }
    const evidenceId = QualityEvidenceId('quality-d')
    const record: QualityExecutionRecord = {
      evidenceId,
      runId: ConductorRunId('CON-2026-0001'),
      childSessionId: SessionId('child-d'),
      commandId: QUALITY_BINDING.id,
      definitionHash: QUALITY_BINDING.definitionHash,
      executionBaselineHash: executionBaselineHash(baseline),
      gate: 'D',
      cycle: 1,
      policyStage: 'headsman',
      executorStage: 'headsman',
      outcome: 'passed',
      exitCode: 0,
      signal: null,
      startedAt: '2026-10-10T00:00:00.000Z',
      finishedAt: '2026-10-10T00:00:01.000Z',
      stdoutSha256: 'b'.repeat(64),
      stderrSha256: 'c'.repeat(64),
      stdoutTruncated: false,
      stderrTruncated: false,
    }
    const run = makeRun({
      currentStage: 'headsman', sourceBaseline: 'HEAD', baseline,
      baselineHistory: [baseline],
      executionAuthorization: {
        executionBaselineHash: executionBaselineHash(baseline),
        effectProfile: { filesystem: 'workspace-write', quality: 'catalog', external: 'none' },
      },
    })
    const outcome = await drive(run, {
      authorizeExecution: authorize,
      async dispatchSpecialist(stage) {
        if (stage === 'headsman') {
          return {
            envelope: makeEnvelope(stage, { quality_evidence_ids: [evidenceId] }),
            qualityExecutions: [record],
            requiredQualityCommands: [QUALITY_BINDING],
          }
        }
        if (stage === 'auditor') {
          return {
            envelope: makeEnvelope(stage, { quality_evidence_ids: [evidenceId] }),
            qualityExecutions: [],
            requiredQualityCommands: [QUALITY_BINDING],
          }
        }
        return makeEnvelope(stage)
      },
      async dispatchArbiter() { return makeDecision() },
    })
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toContain('current dispatch evidence')
  })
  it('rejects non-dispatchable stages and write-capable stages without Gate C', async () => {
    for (const stage of ['intake', 'ralph', 'closeout'] as const) {
      await expect(drive(makeRun({ currentStage: stage }), dispatcherFor(makeEnvelope('detective'))))
        .rejects.toThrow(/cannot dispatch stage/)
    }
    for (const stage of ['headsman', 'auditor', 'integrator'] as const) {
      await expect(drive(makeRun({ currentStage: stage }), dispatcherFor(makeEnvelope(stage))))
        .rejects.toThrow(/immutable Gate C execution baseline/)
    }
  })

  it('rejects every malformed specialist envelope field at the child boundary', async () => {
    const valid = makeEnvelope('detective')
    const malformed: Array<[unknown, RegExp]> = [
      [null, /no structured envelope/],
      [[], /no structured envelope/],
      [{ ...valid, stage: 'strategist' }, /stage does not match/],
      [{ ...valid, baseline_ref: ' ' }, /baseline_ref/],
      [{ ...valid, status: 'unknown' }, /status is invalid/],
      [{ ...valid, source_baseline: 'OTHER' }, /baseline_ref must match/],
      [{ ...valid, summary: '' }, /summary/],
      [{ ...valid, evidence: null }, /list fields/],
      [{ ...valid, findings: null }, /list fields/],
      [{ ...valid, assumptions: null }, /list fields/],
      [{ ...valid, assumptions: [' '] }, /normalized strings/],
      [{ ...valid, evidence: [{ kind: 'test', reference: '', outcome: 'passed' }] }, /envelope evidence/],
      [{ ...valid, findings: [{ id: 'finding', severity: 'low', description: '', impact: 'review' }] }, /envelope findings/],
      [{ ...valid, change_requests: [{ target: 'plan', reason: '', impact: 'review' }] }, /envelope change_requests/],
      [{ ...valid, blockers: null }, /list fields/],
      [{ ...valid, artifacts: null }, /list fields/],
      [{ ...valid, change_requests: null }, /list fields/],
      [{ ...valid, recommended_transition: null }, /recommended_transition/],
      [{ ...valid, recommended_transition: { target: 'strategist', rationale: 'wrong owner' } }, /recommended_transition/],
      [{ ...valid, confidence: 'certain' }, /confidence/],
    ]
    for (const [envelope, message] of malformed) {
      const outcome = await drive(makeRun(), dispatcherFor(envelope))
      expect(outcome.kind).toBe('blocked')
      if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(message)
    }
  })

  it('requires envelope baseline identity after the Detective establishes it', async () => {
    const outcome = await drive(
      makeRun({ currentStage: 'strategist', sourceBaseline: 'HEAD' }),
      dispatcherFor(makeEnvelope('strategist', { baseline_ref: 'OTHER' })),
    )
    expect(outcome.kind).toBe('blocked')
    if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(/assessed baseline HEAD/)
  })

  it('validates every Gate C execution-baseline field and owner path list', async () => {
    const valid = makeEnvelope('devils-advocate').execution_baseline!
    const malformed: Array<[unknown, RegExp]> = [
      [null, /requires execution_baseline/],
      [{ ...valid, scopeVersion: '' }, /scopeVersion/],
      [{ ...valid, planVersion: 1 }, /planVersion/],
      [{ ...valid, acceptanceVersion: ' acceptance ' }, /acceptanceVersion/],
      [{ ...valid, rollbackReference: '' }, /rollbackReference/],
      [{ ...valid, allowedPaths: [1] }, /allowedPaths/],
      [{ ...valid, excludedPaths: [' '] }, /excludedPaths/],
      [{ ...valid, excludedPaths: ['private'] }, /excludedPaths.*owner-declared/],
      [{ ...valid, qualityCommands: null }, /qualityCommands must be an array/],
      [{ ...valid, qualityCommands: [null] }, /must contain bindings/],
      [{ ...valid, qualityCommands: [[]] }, /must contain bindings/],
      [{ ...valid, qualityCommands: ['unit-check'] }, /must contain bindings/],
      [{ ...valid, qualityCommands: [{ ...QUALITY_BINDING, id: ' ' }] }, /normalized id/],
      [{ ...valid, qualityCommands: [{ ...QUALITY_BINDING, definitionHash: 'bad' }] }, /SHA-256/],
      [{ ...valid, qualityCommands: [QUALITY_BINDING, QUALITY_BINDING] }, /must be unique/],
    ]
    for (const [execution_baseline, message] of malformed) {
      const outcome = await drive(
        makeRun({ currentStage: 'devils-advocate', sourceBaseline: 'HEAD' }),
        dispatcherFor(makeEnvelope('devils-advocate', { execution_baseline: execution_baseline as never })),
      )
      expect(outcome.kind).toBe('blocked')
      if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(message)
    }
  })

  it('requires acceptance criteria and normalized fresh evidence for a pass', async () => {
    const cases: Array<[ConductorRun, SpecialistEnvelope, RegExp]> = [
      [makeRun({ acceptanceCriteria: [] }), makeEnvelope('detective'), /acceptance criterion/],
      [makeRun(), makeEnvelope('detective', {
        evidence: [{ kind: 'test', reference: '', outcome: 'passed' }],
      }), /normalized reference and outcome/],
      [makeRun(), makeEnvelope('detective', {
        evidence: [{ kind: 'test', reference: 'check', outcome: ' passed ' }],
      }), /normalized reference and outcome/],
    ]
    for (const [run, envelope, message] of cases) {
      const outcome = await drive(run, dispatcherFor(envelope))
      expect(outcome.kind).toBe('blocked')
      if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(message)
    }
  })

  it('validates Arbiter decision identity, tags, lists, and GO evidence', async () => {
    const valid = makeDecision()
    const malformed: Array<[unknown, RegExp]> = [
      [null, /no structured decision/],
      [[], /no structured decision/],
      [{ ...valid, run_id: 'CON-2026-9999' }, /run_id does not match/],
      [{ ...valid, decision: 'maybe' }, /decision is invalid/],
      [{ ...valid, conditions: [1] }, /conditions/],
      [{ ...valid, open_risks: [' '] }, /open_risks/],
      [{ ...valid, required_follow_up: null }, /required_follow_up/],
      [{ ...valid, basis: [] }, /requires acceptance criteria/],
      [{ ...valid, evidence_reviewed: [] }, /requires acceptance criteria/],
    ]
    for (const [decision, message] of malformed) {
      const outcome = await drive(makeRun({ currentStage: 'arbiter' }), dispatcherFor(valid, decision))
      expect(outcome.kind).toBe('blocked')
      if (outcome.kind === 'blocked') expect(outcome.blocker).toMatch(message)
    }
    const withoutCriteria = await drive(
      makeRun({ currentStage: 'arbiter', acceptanceCriteria: [] }),
      dispatcherFor(valid, valid),
    )
    expect(withoutCriteria.kind).toBe('blocked')
  })

  it('derives every rework defect class and stage fallback without specialist-owned routing', async () => {
    const cases: Array<[ConductorStage, SpecialistEnvelope['change_requests'], ConductorStage]> = [
      ['detective', [], 'detective'],
      ['strategist', [], 'strategist'],
      ['strategist', [{ target: 'plan', reason: 'plan', impact: 'replan' }], 'strategist'],
      ['devils-advocate', [{ target: 'baseline', reason: 'baseline', impact: 'replan' }], 'strategist'],
      ['headsman', [], 'headsman'],
      ['integrator', [], 'integrator'],
    ]
    const baseline = makeEnvelope('devils-advocate').execution_baseline!
    for (const [stage, change_requests, expected] of cases) {
      let firstDispatch = true
      const dispatcher: ConductorDispatcher = {
        authorizeExecution: authorize,
        async dispatchSpecialist(dispatchedStage) {
          if (firstDispatch) {
            firstDispatch = false
            return makeEnvelope(dispatchedStage, { status: 'rework', change_requests })
          }
          return makeEnvelope(dispatchedStage)
        },
        async dispatchArbiter() { return makeDecision() },
      }
      const outcome = await drive(
        makeRun({ currentStage: stage, sourceBaseline: 'HEAD', baseline }),
        dispatcher,
      )
      expect(outcome.kind).toBe('decision')
      expect(outcome.run.history).toContainEqual(expect.objectContaining({ decision: 'rework', nextStage: expected }))
    }
  })
})
