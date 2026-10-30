import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, QualityCommandId, QualityEvidenceId, SpecialistExecutionFailure, applyScriptedOwnerAnswer, consumeOwnerContinuation, contentHash, createRun, currentAuditHash, drive, executionBaselineHash, ownerMandateHash, parseRun, parkOwnerQuestion, recordGate, serializeRun } from '../src/index.ts'
import { analysisEnvelopeProblem } from '../src/analysis.ts'
import type { AnalysisEnvelope, ConductorDispatcher, ConductorRun, ConductorStage, SpecialistEnvelope, QualityExecutionRecord } from '../src/index.ts'
import { analysisReply, analysisRun, implementationAdmission } from './intake-fixtures.ts'

function implementation(): ConductorRun {
  return createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: SessionId('owner-root'), admission: implementationAdmission(),
    objective: 'Review the owner task.', authority: { owner: 'user' }, sourceBaseline: 'HEAD',
  })
}

function envelope(run: ConductorRun, stage: ConductorStage, overrides: Partial<SpecialistEnvelope> = {}): SpecialistEnvelope {
  return { run_id: run.runId, stage, baseline_ref: 'HEAD', source_baseline: 'HEAD', status: 'blocked', summary: 'Owner input required.',
    evidence: [], findings: [], assumptions: [], blockers: ['Owner input required.'], artifacts: [], change_requests: [],
    quality_evidence_ids: [], recommended_transition: { target: 'conductor', rationale: 'Assess the report.' }, confidence: 'high', ...overrides }
}

function dispatcher(reply: (stage: ConductorStage, run: ConductorRun) => unknown): ConductorDispatcher {
  return { dispatchSpecialist: (stage, run) => Promise.resolve(reply(stage, run)),
    dispatchArbiter: () => { throw new Error('Must not reach Arbiter') },
    authorizeExecution: () => { throw new Error('Must not authorize execution') } }
}

function analysisBlocked(run: ConductorRun, overrides: Record<string, unknown> = {}) {
  const reply = analysisReply(run, run.currentStage)
  delete reply.candidate
  return { ...reply, status: 'blocked', blockers: ['Clarify naming.'], ...overrides }
}

const question = { id: 'naming', prompt: 'Which naming convention applies?', options: [] }

describe('P1 owner escalation classification in the driver', () => {
  it('retains completed host command evidence when a specialist fails before returning its report', async () => {
    const run = implementation()
    const record: QualityExecutionRecord = { evidenceId: QualityEvidenceId('completed-command'), runId: run.runId,
      childSessionId: SessionId('failed-child'), commandId: QualityCommandId('unit'), definitionHash: 'a'.repeat(64),
      executionBaselineHash: 'b'.repeat(64), gate: 'D', cycle: 1, policyStage: 'headsman', executorStage: 'headsman',
      outcome: 'passed', exitCode: 0, signal: null, startedAt: '2026-10-30T00:00:00.000Z', finishedAt: '2026-10-30T00:00:01.000Z',
      stdoutSha256: 'c'.repeat(64), stderrSha256: 'd'.repeat(64), stdoutTruncated: false, stderrTruncated: false }
    const failure = new SpecialistExecutionFailure('Child disconnected after a command.', 'headsman', true, [record])
    const checkpoints: ConductorRun[] = []
    await expect(drive(run, dispatcher(() => { throw failure }), (checkpoint) => {
      checkpoints.push(checkpoint); return Promise.resolve()
    })).rejects.toBe(failure)
    expect(checkpoints).toHaveLength(1)
    expect(checkpoints[0]?.qualityExecutions).toEqual([record])
    expect(checkpoints[0]?.specialistReports).toEqual([])
    expect(checkpoints[0]?.history).toEqual([])
  })

  it('requires fresh Auditor command evidence instead of accepting a ready claim', async () => {
    const run = implementation()
    const binding = { id: QualityCommandId('audit'), definitionHash: 'a'.repeat(64), requiredGates: ['E' as const] }
    const baseline = { scopeVersion: 'scope', planVersion: 'plan', acceptanceVersion: 'accept', allowedPaths: [], excludedPaths: [],
      rollbackReference: 'HEAD', qualityCommands: [binding] }
    const auditor: ConductorRun = { ...run, currentStage: 'auditor', acceptanceCriteria: ['Run the independent audit.'], baseline, baselineHistory: [baseline],
      executionAuthorization: { executionBaselineHash: executionBaselineHash(baseline), effectProfile: { filesystem: 'read-only', quality: 'catalog', external: 'none' } } }
    const result = await drive(auditor, dispatcher((stage, current) => ({
      envelope: envelope(current, stage, { status: 'ready', blockers: [], evidence: [{ kind: 'review', reference: 'report', outcome: 'claimed ready' }] }),
      qualityExecutions: [], requiredQualityCommands: [binding],
    })))
    expect(result.kind).toBe('blocked')
    if (result.kind !== 'blocked') throw new Error('test requires blocker')
    expect(result.blocker).toContain('Gate E requires fresh passing quality evidence')
    expect(result.ownerEscalation).toBeUndefined()
  })

  it('retains legitimate authority and plan requests without granting any access', async () => {
    const run = implementation()
    const requests: SpecialistEnvelope['change_requests'] = [
      { target: 'authority', reason: 'Need the exact additional path.', impact: 'Cannot implement before approval.', proposal: { allowedPaths: ['src'], excludedPaths: [], qualityCommandIds: [] } },
      { target: 'plan', reason: 'Choose the canonical provider id.', impact: 'The plan remains incomplete.' },
      { target: 'plan', reason: 'Choose the localhost policy.', impact: 'The plan remains incomplete.' },
    ]
    const result = await drive(run, dispatcher((stage, current) => envelope(current, stage, { change_requests: requests })))
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { kind: 'recoverable', cause: 'authority-amendment' } })
    expect(result.run.specialistReports[0]?.change_requests).toEqual(requests)
    expect(result.run.baseline).toBeNull()
    expect(result.run.executionAuthorization).toBeNull()
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it.each([{ requests: [] }, { requests: [{ target: 'plan' as const, reason: 'Choose a policy.', impact: 'Cannot finish.' }] }])(
    'marks only blocked reports carrying explicit questions as recoverable: %j', async ({ requests }) => {
      const result = await drive(implementation(), dispatcher((stage, run) => envelope(run, stage, { change_requests: [...requests] })))
      if (result.kind !== 'blocked') throw new Error('test requires blocker')
      expect(result.ownerEscalation?.cause).toBe(requests.length ? 'clarification' : undefined)
    })

  it('classifies malformed reports only after bounded rework and never trusts a forged authority request', async () => {
    const result = await drive(implementation(), dispatcher((stage, run) => ({ ...envelope(run, stage), change_requests: [{ target: 'authority' }] })))
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' } })
    expect(result.run.history.map(gate => gate.decision)).toEqual(['rework', 'rework', 'escalate'])
    expect(result.run.specialistReports).toEqual([])
  })

  it.each([
    { target: 'plan', proposal: { allowedPaths: [], excludedPaths: [], qualityCommandIds: [] } },
    { target: 'authority', proposal: null },
    { target: 'authority', proposal: { allowedPaths: [], excludedPaths: [], qualityCommandIds: [], extra: true } },
    { target: 'authority', proposal: { allowedPaths: null, excludedPaths: [], qualityCommandIds: [] } },
    { target: 'authority', proposal: { allowedPaths: [], excludedPaths: null, qualityCommandIds: [] } },
    { target: 'authority', proposal: { allowedPaths: [], excludedPaths: [], qualityCommandIds: null } },
  ])('repairs an incomplete or misplaced authority proposal without granting it: %j', async (request) => {
    const result = await drive(implementation(), dispatcher((stage, run) => ({ ...envelope(run, stage), change_requests: [
      { reason: 'Need a concrete preview.', impact: 'Cannot proceed.', ...request },
    ] })))
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' },
      blocker: 'only authority change_requests may include a complete concrete mandate proposal' })
    expect(result.run.specialistReports).toEqual([])
    expect(result.run.executionAuthorization).toBeNull()
  })

  it('makes a Gate C command outside an accepted owner amendment terminal', async () => {
    const report = { status: 'blocked', reason: 'Use the one approved quality command.' }
    const proposal = { allowedPaths: [], excludedPaths: [], qualityCommandIds: ['unit'] }
    const initial = recordGate({ ...implementation(), acceptanceCriteria: ['Run the approved quality check.'],
      ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: ['unit', 'other'] } },
    { decision: 'escalate', basis: ['Approve an exact command.'], evidenceReviewed: [], stateUpdate: 'Await mandate.' })
    const question = parkOwnerQuestion(initial, 'command-question', { kind: 'recoverable', cause: 'authority-amendment', reason: 'Approve an exact command.' },
      { childId: SessionId('child-1'), attempt: 1, reportHash: contentHash(JSON.stringify(report)), report }, [], proposal)
    const answered = applyScriptedOwnerAnswer(question, { source: 'scripted-test-provider', rootSessionId: SessionId('owner-root'),
      questionId: 'command-question', expectedRevision: 1, action: 'approve', answers: [], proposalHash: ownerMandateHash(proposal) })
    const consumed = consumeOwnerContinuation(answered, 'command-question')
    const result = await drive(consumed, dispatcher((stage, run) => envelope(run, stage, {
      status: 'ready', blockers: [], evidence: [{ kind: 'file', reference: 'plan', outcome: 'assessed' }],
      ...stage === 'devils-advocate' ? { execution_baseline: { scopeVersion: 'scope', planVersion: 'plan', acceptanceVersion: 'accept',
        allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD', qualityCommands: [
          { id: QualityCommandId('other'), definitionHash: 'a'.repeat(64), requiredGates: ['D'] },
        ] } } : {},
    })))
    expect(result).toMatchObject({ kind: 'blocked', blocker: 'Gate C command selection exceeds the effective owner mandate' })
    if (result.kind !== 'blocked') throw new Error('test requires blocker')
    expect(result.ownerEscalation).toBeUndefined()
    expect(result.run.executionAuthorization).toBeNull()
  })

  it('leaves cross-run identity violations terminal even when a report asks for owner authority', async () => {
    const result = await drive(implementation(), dispatcher((stage, run) => envelope(run, stage, {
      run_id: 'CON-2026-9999', change_requests: [{ target: 'authority', reason: 'Approve anyway.', impact: 'None.' }],
    })))
    expect(result.kind).toBe('blocked')
    if (result.kind !== 'blocked') throw new Error('test requires blocker')
    expect(result.ownerEscalation).toBeUndefined()
    expect(result.run.history).toHaveLength(1)
  })

  it.each(['question', 'answer'] as const)('refuses %s state before any dispatch without a consumed scripted continuation', async (state) => {
    const initial = implementation()
    const report = { status: 'blocked', clarifications: [question] }
    const escalated = recordGate(initial, { decision: 'escalate', basis: ['Clarify naming.'], evidenceReviewed: [], stateUpdate: 'Wait.' })
    let run = parkOwnerQuestion(escalated, 'owner-question', { kind: 'recoverable', cause: 'clarification', reason: 'Clarify naming.' },
      { childId: SessionId('child-1'), attempt: 1, reportHash: contentHash(JSON.stringify(report)), report }, [question])
    if (state === 'answer') run = applyScriptedOwnerAnswer(run, { source: 'scripted-test-provider', rootSessionId: SessionId('owner-root'),
      questionId: 'owner-question', expectedRevision: 1, action: 'answer_continue', answers: [{ itemId: 'naming', text: 'Use the repository convention.' }] })
    const dispatch = vi.fn()
    await expect(drive(run, { dispatchSpecialist: dispatch, dispatchArbiter: dispatch, authorizeExecution: dispatch }))
      .rejects.toThrow('no production owner resumption')
    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('P1 analysis clarification is read-only', () => {
  it('has no successful audit hash before an independent report audit', () => {
    expect(currentAuditHash(analysisRun())).toBeUndefined()
  })

  it('captures explicit read-only questions as recoverable owner input', async () => {
    const run = analysisRun()
    const result = await drive(run, dispatcher((_stage, current) => analysisBlocked(current, { clarifications: [question] })))
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { kind: 'recoverable', cause: 'clarification' } })
    expect(result.run.analysisReports[0]?.clarifications).toEqual([question])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
    expect(result.run.executionAuthorization).toBeNull()
  })

  it.each([
    undefined, [], new Array(17).fill(question), [null], [{ ...question, unknown: true }],
    [{ ...question, id: '' }], [{ ...question, prompt: '' }], [{ ...question, options: null }],
    [{ ...question, options: ['a', 'a'] }], [question, question],
  ])('validates clarification item identities, required content and options: %j', (clarifications) => {
    const run = analysisRun()
    const reply = analysisBlocked(run, { clarifications })
    const problem = analysisEnvelopeProblem(reply, 'detective', run)
    expect(problem?.message).toBe(clarifications === undefined ? undefined
      : 'analysis clarifications require unique read-only questions on a blocked report')
  })

  it('treats an analysis report for a different stage as a terminal routing violation', async () => {
    const result = await drive(analysisRun(), dispatcher((_stage, current) => analysisBlocked(current, { stage: 'headsman' })))
    expect(result.kind).toBe('blocked')
    if (result.kind !== 'blocked') throw new Error('test requires blocker')
    expect(result.ownerEscalation).toBeUndefined()
    expect(result.run.history).toHaveLength(1)
  })

  it('never accepts clarification requests attached to a ready report', () => {
    const run = analysisRun()
    const reply: AnalysisEnvelope = { ...analysisReply(run, 'detective'), clarifications: [question] }
    expect(analysisEnvelopeProblem(reply, 'detective', run)?.message)
      .toBe('analysis clarifications require unique read-only questions on a blocked report')
  })

  it('classifies failed parsing and explicit rework exhaustion separately from security failures', async () => {
    const malformed = await drive(analysisRun(), dispatcher(() => ({})))
    expect(malformed).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' } })
    const rework = await drive(analysisRun(), dispatcher((_stage, current) => analysisBlocked(current, { status: 'rework' })))
    expect(rework).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' } })
    const authority = await drive(analysisRun(), dispatcher((_stage, current) => analysisBlocked(current, { change_requests: [] })))
    expect(authority.kind).toBe('blocked')
    if (authority.kind !== 'blocked') throw new Error('test requires blocker')
    expect(authority.ownerEscalation).toBeUndefined()
    expect(authority.run.history).toHaveLength(1)
    const failed = await drive(analysisRun(), dispatcher((_stage, current) => analysisBlocked(current, { status: 'failed' })))
    if (failed.kind !== 'blocked') throw new Error('test requires blocker')
    expect(failed.ownerEscalation).toBeUndefined()
  })
})
