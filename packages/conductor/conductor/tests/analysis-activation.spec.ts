import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session'
import { applyScriptedOwnerAnswer, consumeOwnerContinuation, drive, parkOwnerQuestion, parseRun, serializeRun, validateResumable,
  validateAnalysisChallenge } from '../src/index.ts'
import type { ConductorDispatcher, ConductorRun, CriticDispatchResult } from '../src/index.ts'
import { analysisEnvelopeProblem } from '../src/analysis.ts'
import { parseAnalysisState } from '../src/analysis-persistence.ts'
import { contentHash } from '../src/intake.ts'
import { validateIntakeHistory } from '../src/intake-history.ts'
import { ownerContinuationRoute, parseOwnerInteraction } from '../src/owner-ledger.ts'
import { acceptedReport, analysisReply, analysisRun, implementationAdmission, withAnalysisDispatch } from './intake-fixtures.ts'

function criticResult(run: ConductorRun, criticAttempt: number, result: 'holds' | 'major' | 'critical' | 'malformed',
  defect: 'scope' | 'plan' | 'report' = 'report'): CriticDispatchResult {
  if (run.admission.purpose !== 'analysis') throw new Error('test requires analysis')
  const candidate = run.reportCandidates.at(-1)!
  const childId = SessionId(`critic-attempt-${criticAttempt}`)
  const materialIds = candidate.candidate.material_ids.map(id => run.admission.materials.find(material => material.id === id)!.id)
  const common = { run_id: run.runId, purpose: 'analysis' as const, candidate_hash: candidate.hash,
    candidate_version: candidate.candidate.version, material_ids: materialIds, critic_child_id: childId,
    critic_attempt: criticAttempt, summary: 'The cited reasoning needs a stronger comparison of alternatives.' }
  const findings = [{ id: `finding-${criticAttempt}`, severity: result === 'critical' ? 'critical' as const : 'major' as const,
    claim: 'The recommendation overlooks an alternative.', rationale: 'The cited material does not compare the alternatives.',
    material_ids: [materialIds[0]!] }]
  const challenge = result === 'holds' ? { ...common, conclusion: 'holds' as const, findings: [] }
    : { ...common, conclusion: 'does_not_hold' as const, defect,
      findings: result === 'malformed' ? [] : findings }
  return { kind: 'attempt', childId, inputTokens: 37, outputTokens: 19,
    validation: validateAnalysisChallenge(challenge, {
      runId: run.runId, candidateHash: candidate.hash, candidateVersion: candidate.candidate.version,
      materialIds, criticChildId: childId, producerChildId: candidate.producerChildId,
      criticAttempt, dispatchMode: 'critic', entry: run.admission.entry, deliverable: run.admission.deliverable,
      producer: candidate.producer, maxSummaryCharacters: 1000,
      previous: run.analysisChallenges.map(previous => ({ challenge: previous.challenge, hash: previous.hash })),
    }) }
}

function readyDispatcher(onCritic: (run: ConductorRun, attempt: number) => Promise<CriticDispatchResult>) {
  const producer = vi.fn((stage: string, run: ConductorRun) => Promise.resolve(analysisReply(run, stage, `v${run.reportCandidates.length + 1}`)))
  const dispatcher = withAnalysisDispatch({
    dispatchSpecialist: producer,
    dispatchArbiter: run => Promise.resolve(acceptedReport(run)),
    authorizeExecution: () => { throw new Error('analysis must not request approval') },
  })
  return { producer, dispatcher: { ...dispatcher, dispatchCritic: onCritic } }
}

describe('v5 analysis challenge routing and durable provenance', () => {
  it('binds blocked and exhausted revision decisions to the exact final Gate G assessment', async () => {
    const blocked = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const blockedResult = await drive(analysisRun(), { ...blocked.dispatcher,
      dispatchArbiter: run => Promise.resolve({ ...acceptedReport(run), decision: 'blocked' as const }) })
    expect(blockedResult).toMatchObject({ kind: 'blocked', run: { status: 'escalated' } })
    expect(parseRun(serializeRun(blockedResult.run))).toEqual(blockedResult.run)

    const revised = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const original = analysisRun()
    const revisedResult = await drive({ ...original, budget: { ...original.budget, maxReworkPerGate: 1 } }, {
      ...revised.dispatcher,
      dispatchArbiter: run => Promise.resolve({ ...acceptedReport(run), decision: 'revise' as const }),
    })
    expect(revisedResult).toMatchObject({ kind: 'blocked', run: { status: 'escalated' } })
    expect(revisedResult.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2'])
    expect(revisedResult.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2])
    expect(revisedResult.run.history.at(-1)).toMatchObject({ gate: 'G', decision: 'escalate',
      basis: ['The report and independent audit address the owner question.', 'Gate G exhausted its 1 reworks per gate'] })
    expect(parseRun(serializeRun(revisedResult.run))).toEqual(revisedResult.run)
    const premature = structuredClone(revisedResult.run)
    premature.budget.maxReworkPerGate = 2
    const finalGate = premature.history.at(-1)
    if (finalGate?.kind !== 'evaluated') throw new Error('test requires final gate')
    finalGate.basis[1] = 'Gate G exhausted its 2 reworks per gate'
    expect(() => parseRun(serializeRun(premature))).toThrow(/final gate assessment/)
    const overBudget = structuredClone(revisedResult.run)
    overBudget.budget.maxReworkPerGate = 0
    expect(() => { validateIntakeHistory(overBudget) }).toThrow(/exceeds its per-gate rework budget/)
  })

  it('reworks the producer for a substantive challenge and recriticizes the new candidate before audit', async () => {
    const { dispatcher, producer } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt,
      attempt === 1 ? 'major' : 'holds')))
    const result = await drive(analysisRun(), dispatcher, (run) => {
      expect(parseRun(serializeRun(run))).toEqual(run)
      return Promise.resolve()
    })
    expect(result.kind).toBe('report')
    expect(producer.mock.calls.filter(([stage]) => stage === 'detective')).toHaveLength(2)
    expect(result.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2'])
    expect(result.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2])
    expect(result.run.history.filter(gate => gate.gate === 'C' && gate.kind === 'evaluated')
      .map(gate => gate.decision)).toEqual(['rework', 'pass'])
    expect(result.run.reportDecision?.challenge_hash).toBe(result.run.analysisChallenges.at(-1)?.hash)
  })

  it('returns a planning challenge to Strategist before a new critique', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt,
      attempt === 1 ? 'major' : 'holds', 'plan')))
    const result = await drive(analysisRun('detective', 'recommendations'), dispatcher)
    expect(result.kind).toBe('report')
    expect(result.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2'])
    expect(result.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2])
    expect(result.run.history.find(gate => gate.kind === 'evaluated' && gate.gate === 'C'
      && gate.decision === 'rework')).toMatchObject({ defectClass: 'plan', nextStage: 'strategist' })
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('retries malformed critic output under Gate C without rerunning the producer', async () => {
    const { dispatcher, producer } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'malformed')))
    const result = await drive(analysisRun(), dispatcher)
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' } })
    expect(producer.mock.calls.filter(([stage]) => stage === 'detective')).toHaveLength(1)
    expect(result.run.analysisChallenges).toEqual([])
    expect(result.run.history.filter(gate => gate.gate === 'C' && gate.kind === 'evaluated')
      .map(gate => gate.kind === 'evaluated'
        ? [gate.decision, gate.analysis?.criticAttempt, gate.analysis?.inputTokens, gate.analysis?.outputTokens] : []))
      .toEqual([['rework', 1, 37, 19], ['rework', 2, 37, 19], ['escalate', 3, 37, 19]])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('routes an Auditor analysis defect through a new candidate and critique, while report repair stays at Auditor', async () => {
    for (const defect of ['analysis', 'report'] as const) {
      let auditorCalls = 0
      const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
      const result = await drive(analysisRun(), { ...dispatcher,
        dispatchSpecialist: (stage, run) => Promise.resolve(stage === 'auditor' && auditorCalls++ === 0
          ? { ...analysisReply(run, stage), status: 'rework' as const, defect }
          : analysisReply(run, stage)),
      })
      expect(result.kind).toBe('report')
      expect(auditorCalls).toBe(2)
      const auditedRework = result.run.history.find(gate => gate.kind === 'evaluated' && gate.stage === 'auditor'
        && gate.decision === 'rework')
      expect(auditedRework).toMatchObject({ defectClass: defect,
        nextStage: defect === 'analysis' ? 'detective' : 'auditor' })
      expect(result.run.reportCandidates.map(candidate => candidate.candidate.version))
        .toEqual(defect === 'analysis' ? ['v1', 'v2'] : ['v1'])
      expect(result.run.analysisChallenges.map(challenge => challenge.criticAttempt))
        .toEqual(defect === 'analysis' ? [1, 2] : [1])
      expect(parseRun(serializeRun(result.run))).toEqual(result.run)
      if (defect === 'analysis') {
        const forged = structuredClone(result.run)
        const gate = forged.history.find(record => record.kind === 'evaluated' && record.stage === 'auditor'
          && record.decision === 'rework')
        if (gate?.kind !== 'evaluated') throw new Error('test requires Auditor rework')
        gate.defectClass = 'report'
        gate.nextStage = 'auditor'
        expect(() => parseRun(serializeRun(forged))).toThrow(/rework does not match the specialist defect and target/)
      }
    }

    const initial = analysisRun()
    const producerRework = { ...analysisReply(initial, 'detective'), status: 'rework' as const,
      defect: 'analysis' as const }
    expect(analysisEnvelopeProblem(producerRework, 'detective', initial)?.message)
      .toMatch(/valid only for Auditor rework/)
    expect(analysisEnvelopeProblem({ ...producerRework, stage: 'auditor', status: 'ready' }, 'auditor', initial)?.message)
      .toMatch(/valid only for Auditor rework/)
    expect(analysisEnvelopeProblem({ ...producerRework, stage: 'auditor', status: 'ready', defect: undefined,
      candidate: undefined, candidate_hash: 'stale' }, 'auditor', initial)?.message)
      .toMatch(/requires a holding challenge/)
  })

  it('replays a default Auditor analysis defect when Gate E rework is exhausted', async () => {
    const initial = analysisRun()
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const result = await drive({ ...initial, budget: { ...initial.budget, maxReworkPerGate: 1 } }, {
      ...dispatcher,
      dispatchSpecialist: (stage, run) => Promise.resolve(stage === 'auditor'
        ? { ...analysisReply(run, stage), status: 'rework' as const } : analysisReply(run, stage)),
    })
    expect(result).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' },
      run: { status: 'escalated' } })
    expect(result.run.history.filter(gate => gate.kind === 'evaluated' && gate.gate === 'E')
      .map(gate => gate.decision)).toEqual(['rework', 'escalate'])
    expect(result.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2'])
    expect(result.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('fails closed on missing typed producer or critic composition and contradictory budget identity', async () => {
    const initial = analysisRun('devils-advocate')
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    await expect(drive({ ...initial, analysisMode: null }, dispatcher))
      .rejects.toThrow(/typed producer or critic dispatch mode/)
    const withoutProducer: ConductorDispatcher = { ...dispatcher }
    Reflect.deleteProperty(withoutProducer, 'dispatchAnalysisProducer')
    await expect(drive(initial, withoutProducer))
      .rejects.toThrow(/producer dispatcher is unavailable/)
    const withoutCritic: ConductorDispatcher = { ...dispatcher }
    Reflect.deleteProperty(withoutCritic, 'dispatchCritic')
    await expect(drive(initial, withoutCritic))
      .rejects.toThrow(/critic dispatcher is unavailable/)
    await expect(drive(initial, { ...dispatcher, dispatchCritic: () => Promise.resolve({
      kind: 'blocked', problem: { kind: 'report', message: 'No remaining critic budget.' }, criticAttempt: 1,
    }) })).rejects.toThrow(/budget result contradicts its reserved attempt/)
    await expect(drive({ ...initial, analysisMode: 'critic', reportCandidates: [] }, dispatcher))
      .rejects.toThrow(/requires a retained report candidate/)
    await expect(drive(initial, { ...dispatcher, dispatchCritic: (_run, attempt) => Promise.resolve({
      kind: 'blocked', problem: { kind: 'report', message: 'Started critic failed.' },
      childId: SessionId('started-critic'), criticAttempt: attempt + 1, inputTokens: 1, outputTokens: 1,
    }) })).rejects.toThrow(/budget result contradicts its reserved attempt/)
  })

  it('records a started critic failure and terminal authority violation without losing the child attempt', async () => {
    const reason = 'Started critic child stopped before a valid challenge.'
    const started = readyDispatcher((_run, attempt) => Promise.resolve({ kind: 'blocked',
      problem: { kind: 'report', message: reason }, childId: SessionId('started-critic'),
      criticAttempt: attempt, inputTokens: 7, outputTokens: 3 }))
    const blocked = await drive(analysisRun(), started.dispatcher)
    expect(blocked).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' } })
    expect(blocked.run.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate',
      analysis: { mode: 'critic', childId: 'started-critic', criticAttempt: 1, inputTokens: 7, outputTokens: 3 } })
    expect(parseRun(serializeRun(blocked.run))).toEqual(blocked.run)
    const unmeasured = readyDispatcher((_run, attempt) => Promise.resolve({ kind: 'blocked',
      problem: { kind: 'report', message: reason }, childId: SessionId('unmeasured-critic'), criticAttempt: attempt }))
    const unmeasuredResult = await drive(analysisRun(), unmeasured.dispatcher)
    expect(unmeasuredResult.run.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate',
      analysis: { mode: 'critic', childId: 'unmeasured-critic', criticAttempt: 1 } })
    expect(parseRun(serializeRun(unmeasuredResult.run))).toEqual(unmeasuredResult.run)

    const foreign = readyDispatcher((run, attempt) => {
      const result = criticResult(run, attempt, 'holds')
      if (result.kind !== 'attempt') throw new Error('test requires a critic attempt')
      return Promise.resolve({ ...result, validation: { problem: { kind: 'authority' as const, message: 'foreign run' } } })
    })
    const terminal = await drive(analysisRun(), foreign.dispatcher)
    expect(terminal).toMatchObject({ kind: 'blocked', run: { status: 'escalated' } })
    if (terminal.kind !== 'blocked') throw new Error('test requires authority blocker')
    expect(terminal.ownerEscalation).toBeUndefined()
    expect(terminal.run.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate',
      stateUpdate: 'reject critic authority problem' })
    expect(parseRun(serializeRun(terminal.run))).toEqual(terminal.run)
  })

  it('rejects a foreign prerequisite without inventing a producer child', async () => {
    const initial = analysisRun('detective', 'recommendations')
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const result = await drive(initial, { ...dispatcher,
      dispatchSpecialist: (stage, run) => Promise.resolve({ ...analysisReply(run, stage), run_id: 'foreign-run' }),
    })
    expect(result).toMatchObject({ kind: 'blocked', run: { status: 'escalated' } })
    expect(result.run.history.find(gate => gate.kind === 'evaluated')).toMatchObject({
      gate: 'A', decision: 'escalate', stateUpdate: 'reject analysis authority problem',
    })
    expect(result.run.reportCandidates).toEqual([])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('retries a producer report defect before accepting its first candidate', async () => {
    let producerCalls = 0
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const result = await drive(analysisRun(), { ...dispatcher,
      dispatchAnalysisProducer: (stage, run) => {
        const value = analysisReply(run, stage, 'v1')
        if (producerCalls++ === 0) {
          value.status = 'rework'
          delete value.candidate
        }
        return Promise.resolve({ childId: SessionId(`producer-${producerCalls}`), value })
      },
    })
    expect(result.kind).toBe('report')
    expect(producerCalls).toBe(2)
    expect(result.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1'])
    expect(result.run.history.filter(gate => gate.kind === 'evaluated' && gate.stage === 'detective')
      .map(gate => gate.decision)).toEqual(['rework', 'pass'])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('resumes after a malformed critic attempt with the next run-wide attempt number', async () => {
    let saved: ConductorRun | undefined
    const { dispatcher, producer } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt,
      attempt === 1 ? 'malformed' : 'holds')))
    await expect(drive(analysisRun(), dispatcher, (run) => {
      saved = run
      const last = run.history.at(-1)
      return last?.kind === 'evaluated' && last.analysis?.mode === 'critic'
        ? Promise.reject(new Error('checkpoint interruption')) : Promise.resolve()
    })).rejects.toThrow('checkpoint interruption')
    const recovered = parseRun(serializeRun(saved!))
    validateResumable(recovered)
    const result = await drive(recovered, dispatcher)
    expect(result.kind).toBe('report')
    expect(producer.mock.calls.filter(([stage]) => stage === 'detective')).toHaveLength(1)
    expect(result.run.history.filter(gate => gate.kind === 'evaluated' && gate.analysis?.mode === 'critic')
      .map(gate => gate.kind === 'evaluated' ? gate.analysis?.criticAttempt : undefined)).toEqual([1, 2])
    expect(result.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([2])
  })

  it('keeps critical findings escalated with the exact reason and no answerable continuation', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'critical')))
    const initial = analysisRun()
    const result = await drive({ ...initial, ownerSessionId: SessionId('owner-root') }, dispatcher)
    expect(result.kind).toBe('blocked')
    if (result.kind !== 'blocked') throw new Error('test requires a blocker')
    expect(result.blocker).toContain('The cited reasoning needs a stronger comparison of alternatives.')
    expect(result.ownerEscalation).toBeUndefined()
    expect(result.run.analysisChallenges).toHaveLength(1)
    expect(result.run.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate', analysis: { conclusion: 'does_not_hold' } })
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
    const source = result.run.history.at(-1)
    if (source?.kind !== 'evaluated' || source.analysis?.mode !== 'critic') throw new Error('test requires critical challenge')
    const childId = source.analysis.childId!
    const attempt = source.analysis.criticAttempt!
    const report = result.run.analysisChallenges.at(-1)!.challenge
    expect(() => parkOwnerQuestion(result.run, 'critical-challenge', {
      kind: 'recoverable', cause: 'rework-exhausted', reason: report.summary,
    }, { sourceKind: 'child', childId, attempt,
      report, reportHash: contentHash(JSON.stringify(report)) },
    [{ id: 'critical', prompt: 'Reconsider the risk.', options: [] }])).toThrow(/critical challenge has no read-only owner continuation/)
  })

  it('binds a predispatch budget question to its host report without inventing a child', async () => {
    const reason = 'Critic input exceeds the configured run budget.'
    const { dispatcher } = readyDispatcher(() => Promise.resolve({ kind: 'blocked', problem: { kind: 'report', message: reason } }))
    const result = await drive({ ...analysisRun(), ownerSessionId: SessionId('owner-root') }, dispatcher)
    expect(result.kind).toBe('blocked')
    const candidateHash = result.run.reportCandidates.at(-1)!.hash
    expect(result.run.history.at(-1)).toMatchObject({ gate: 'C', decision: 'escalate', origin: 'critic-budget' })
    const report = { kind: 'critic-budget', candidateHash, reason }
    const parked = parkOwnerQuestion(result.run, 'critic-budget-question', {
      kind: 'recoverable', cause: 'rework-exhausted', reason,
    }, { sourceKind: 'host', childId: null, attempt: null, report, reportHash: contentHash(JSON.stringify(report)) },
    [{ id: 'budget', prompt: 'Provide a narrower evidence basis.', options: [] }])
    expect(parseRun(serializeRun(parked))).toEqual(parked)
    const entry = parked.ownerLedger[0]
    if (entry?.kind !== 'question') throw new Error('test requires owner question')
    expect(() => parseOwnerInteraction({ ...entry,
      question: { ...entry.question, childId: SessionId('invalid-host-child') } })).toThrow()
    const answered = applyScriptedOwnerAnswer(parked, { source: 'scripted-test-provider',
      rootSessionId: SessionId('owner-root'), questionId: 'critic-budget-question', expectedRevision: 1,
      action: 'answer_continue', answers: [{ itemId: 'budget', text: 'Use the cited material.' }] })
    const resumed = consumeOwnerContinuation(answered, 'critic-budget-question')
    expect(resumed.analysisMode).toBe('critic')
    expect(resumed.executionAuthorization).toBeNull()
    expect(parseRun(serializeRun(resumed))).toEqual(resumed)
    const forged = structuredClone(parked)
    if (forged.ownerLedger[0]?.kind !== 'question') throw new Error('test requires a question')
    forged.ownerLedger[0].question.report = { ...report, candidateHash: '0'.repeat(64) }
    forged.ownerLedger[0].question.reportHash = contentHash(JSON.stringify(forged.ownerLedger[0].question.report))
    expect(() => parseRun(serializeRun(forged))).toThrow(/host owner question/)
    const disguised = structuredClone(parked)
    const disguisedQuestion = disguised.ownerLedger[0]
    if (disguisedQuestion?.kind !== 'question') throw new Error('test requires owner question')
    disguisedQuestion.question.sourceKind = 'child'
    disguisedQuestion.question.childId = SessionId('forged-child')
    disguisedQuestion.question.attempt = 1
    expect(() => parseRun(serializeRun(disguised))).toThrow(/child owner question requires a real child source/)

    const altered = structuredClone(result.run)
    const budgetGate = altered.history.findLast(gate => gate.kind === 'evaluated')
    if (budgetGate?.kind !== 'evaluated') throw new Error('test requires a budget gate')
    budgetGate.evidenceReviewed = []
    expect(() => parseRun(serializeRun(altered))).toThrow(/critic budget gate does not match/)
    const forgedDispatch = structuredClone(result.run)
    const sourceGate = forgedDispatch.history.findLast(gate => gate.kind === 'evaluated')
    if (sourceGate?.kind !== 'evaluated') throw new Error('test requires a budget gate')
    sourceGate.analysis = { mode: 'critic', childId: SessionId('unstarted-child') }
    expect(() => { validateIntakeHistory(forgedDispatch) }).toThrow(/critic budget must stop its exact Gate C dispatch/)
  })

  it('binds entry C owner escalation to the latest producer candidate after a critic pass', async () => {
    const reason = 'The second critic attempt exceeds the run budget.'
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(attempt === 1
      ? criticResult(run, attempt, 'holds')
      : { kind: 'blocked', problem: { kind: 'report', message: reason } }))
    const initial = analysisRun('devils-advocate')
    const result = await drive({ ...initial, ownerSessionId: SessionId('owner-root') }, {
      ...dispatcher, dispatchArbiter: run => Promise.resolve({ ...acceptedReport(run), decision: 'revise' as const }),
    })
    expect(result).toMatchObject({ kind: 'blocked', run: { status: 'escalated' } })
    expect(result.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2'])
    expect(result.run.history.filter(gate => gate.kind === 'evaluated' && gate.stage === 'devils-advocate'
      && gate.decision === 'pass').map(gate => gate.kind === 'evaluated' ? gate.analysis?.mode : undefined))
      .toEqual(['producer', 'critic', 'producer'])
    const candidateHash = result.run.reportCandidates.at(-1)!.hash
    const report = { kind: 'critic-budget', candidateHash, reason }
    const parked = parkOwnerQuestion(result.run, 'entry-c-budget', {
      kind: 'recoverable', cause: 'rework-exhausted', reason,
    }, { sourceKind: 'host', childId: null, attempt: null, report, reportHash: contentHash(JSON.stringify(report)) },
    [{ id: 'budget', prompt: 'Provide a narrower evidence basis.', options: [] }])
    expect(parseRun(serializeRun(parked))).toEqual(parked)
  })

  it('resumes an entry-C producer clarification in producer mode', async () => {
    const initial = analysisRun('devils-advocate')
    const childId = SessionId('producer-clarification')
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const report = analysisReply(initial, 'devils-advocate')
    report.status = 'blocked'
    report.blockers = ['The scope needs an owner answer.']
    report.clarifications = [{ id: 'scope', prompt: 'Clarify the scope.', options: [] }]
    delete report.candidate
    const blocked = await drive({ ...initial, ownerSessionId: SessionId('owner-root') }, {
      ...dispatcher, dispatchAnalysisProducer: () => Promise.resolve({ value: report, childId }),
    })
    if (blocked.kind !== 'blocked' || blocked.ownerEscalation === undefined) throw new Error('test requires owner question')
    const parked = parkOwnerQuestion(blocked.run, 'producer-clarification', blocked.ownerEscalation,
      { sourceKind: 'child', childId, attempt: 1, report, reportHash: contentHash(JSON.stringify(report)) },
      [{ id: 'scope', prompt: 'Clarify the scope.', options: [] }])
    const answered = applyScriptedOwnerAnswer(parked, { source: 'scripted-test-provider',
      rootSessionId: SessionId('owner-root'), questionId: 'producer-clarification', expectedRevision: 1,
      action: 'answer_continue', answers: [{ itemId: 'scope', text: 'Assess the cited request.' }] })
    const untyped = structuredClone(answered)
    const source = untyped.history.at(-1)
    const question = untyped.ownerLedger.find(entry => entry.kind === 'question')
    const answer = untyped.ownerLedger.find(entry => entry.kind === 'answer')
    if (source?.kind !== 'evaluated' || question?.kind !== 'question' || answer?.kind !== 'answer') {
      throw new Error('test requires a typed source and owner answer')
    }
    delete source.analysis
    expect(() => ownerContinuationRoute(untyped, question.question, answer.plan, untyped.repairReturns))
      .toThrow(/requires typed Gate C dispatch/)
    const resumed = consumeOwnerContinuation(answered, 'producer-clarification')
    expect(resumed.analysisMode).toBe('producer')
    expect(resumed.currentStage).toBe('devils-advocate')
    expect(parseRun(serializeRun(resumed))).toEqual(resumed)
  })

  it('resumes an exhausted substantive challenge at its producer and requires a fresh critique', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt,
      attempt <= 2 ? 'major' : 'holds')))
    const initial = analysisRun()
    const blocked = await drive({ ...initial, ownerSessionId: SessionId('owner-root'),
      budget: { ...initial.budget, maxReworkPerGate: 1 } }, dispatcher)
    expect(blocked).toMatchObject({ kind: 'blocked', ownerEscalation: { cause: 'rework-exhausted' },
      run: { status: 'escalated' } })
    if (blocked.kind !== 'blocked' || blocked.ownerEscalation === undefined) throw new Error('test requires owner escalation')
    const last = blocked.run.history.at(-1)
    if (last?.kind !== 'evaluated' || last.analysis?.mode !== 'critic') throw new Error('test requires failed challenge')
    expect(last).toMatchObject({ gate: 'C', decision: 'escalate', nextStage: 'detective' })
    const report = blocked.run.analysisChallenges.at(-1)!.challenge
    const question = parkOwnerQuestion(blocked.run, 'challenge-rework', blocked.ownerEscalation,
      { sourceKind: 'child', childId: last.analysis.childId!, attempt: last.analysis.criticAttempt!,
        report, reportHash: contentHash(JSON.stringify(report)) },
      [{ id: 'scope', prompt: 'Clarify the report priority.', options: [] }])
    const answered = applyScriptedOwnerAnswer(question, { source: 'scripted-test-provider',
      rootSessionId: SessionId('owner-root'), questionId: 'challenge-rework', expectedRevision: 1,
      action: 'answer_continue', answers: [{ itemId: 'scope', text: 'Reassess the priority from the cited material.' }] })
    const missingChallenge = structuredClone(answered)
    missingChallenge.analysisChallenges = []
    expect(() => consumeOwnerContinuation(missingChallenge, 'challenge-rework'))
      .toThrow(/requires its exact failed challenge/)
    const resumed = consumeOwnerContinuation(answered, 'challenge-rework')
    expect(resumed).toMatchObject({ currentStage: 'detective', analysisMode: 'producer',
      executionAuthorization: null, status: 'rework' })
    expect(parseRun(serializeRun(resumed))).toEqual(resumed)
    const completed = await drive(resumed, dispatcher)
    expect(completed.kind).toBe('report')
    expect(completed.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2', 'v3'])
    expect(completed.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2, 3])
    expect(parseRun(serializeRun(completed.run))).toEqual(completed.run)
  })

  it('reconstructs a prerequisite return when owner continuation follows a scope challenge', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt,
      attempt <= 2 ? 'major' : 'holds', 'scope')))
    const initial = analysisRun('detective', 'recommendations')
    const blocked = await drive({ ...initial, ownerSessionId: SessionId('owner-root'),
      budget: { ...initial.budget, maxReworkPerGate: 1 } }, dispatcher)
    if (blocked.kind !== 'blocked' || blocked.ownerEscalation === undefined) throw new Error('test requires owner escalation')
    const source = blocked.run.history.at(-1)
    if (source?.kind !== 'evaluated' || source.analysis?.mode !== 'critic') throw new Error('test requires failed challenge')
    expect(source).toMatchObject({ gate: 'C', decision: 'escalate', nextStage: 'detective' })
    const report = blocked.run.analysisChallenges.at(-1)!.challenge
    const parked = parkOwnerQuestion(blocked.run, 'scope-rework', blocked.ownerEscalation,
      { sourceKind: 'child', childId: source.analysis.childId!, attempt: source.analysis.criticAttempt!,
        report, reportHash: contentHash(JSON.stringify(report)) },
      [{ id: 'scope', prompt: 'Clarify the scope of the recommendation.', options: [] }])
    for (const mutate of [(run: ConductorRun) => {
      const entry = run.ownerLedger[0]
      if (entry?.kind !== 'question') throw new Error('test requires owner question')
      entry.question.childId = SessionId('foreign-child')
    }, (run: ConductorRun) => {
      const entry = run.ownerLedger[0]
      if (entry?.kind !== 'question') throw new Error('test requires owner question')
      entry.question.attempt = 99
    }]) {
      const forged = structuredClone(parked)
      mutate(forged)
      expect(() => parseRun(serializeRun(forged))).toThrow(/child owner question must match the exact analysis dispatch/)
    }
    const answered = applyScriptedOwnerAnswer(parked, { source: 'scripted-test-provider',
      rootSessionId: SessionId('owner-root'), questionId: 'scope-rework', expectedRevision: 1,
      action: 'answer_continue', answers: [{ itemId: 'scope', text: 'Compare the cited alternatives.' }] })
    const resumed = consumeOwnerContinuation(answered, 'scope-rework')
    expect(resumed.currentStage).toBe('detective')
    expect(resumed.analysisMode).toBeNull()
    expect(resumed.repairReturns.at(-1)).toEqual({ stage: 'detective', returnTo: 'strategist' })
    expect(parseRun(serializeRun(resumed))).toEqual(resumed)
    const completed = await drive(resumed, dispatcher)
    expect(completed.kind).toBe('report')
    expect(completed.run.reportCandidates.map(candidate => candidate.candidate.version)).toEqual(['v1', 'v2', 'v3'])
    expect(completed.run.analysisChallenges.map(challenge => challenge.criticAttempt)).toEqual([1, 2, 3])
    expect(parseRun(serializeRun(completed.run))).toEqual(completed.run)
  })

  it('rejects forged dispatch metadata and unvalidated critic passes on replay', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const original = (await drive(analysisRun(), dispatcher)).run
    const cases: Array<{ mutate: (run: ConductorRun) => void; message: RegExp }> = [
      { mutate: (run) => {
        const gate = run.history.find(record => record.kind === 'evaluated' && record.analysis?.mode === 'producer')
        if (gate?.kind !== 'evaluated' || gate.analysis === undefined) throw new Error('test requires producer gate')
        Reflect.set(gate.analysis, 'foreign', true)
      }, message: /malformed dispatch metadata/ },
      { mutate: (run) => {
        const gate = run.history.find(record => record.kind === 'evaluated' && record.analysis?.mode === 'producer')
        if (gate?.kind !== 'evaluated' || gate.analysis === undefined) throw new Error('test requires producer gate')
        gate.analysis.mode = 'critic'
      }, message: /dispatch mode does not match/ },
      { mutate: (run) => {
        const gate = run.history.find(record => record.kind === 'evaluated' && record.analysis?.mode === 'critic')
        if (gate?.kind !== 'evaluated' || gate.analysis?.mode !== 'critic') throw new Error('test requires critic gate')
        delete gate.analysis.challengeHash
      }, message: /critic gate pass requires a validated challenge/ },
    ]
    for (const { mutate, message } of cases) {
      const forged = structuredClone(original)
      mutate(forged)
      expect(() => parseRun(serializeRun(forged))).toThrow(message)
    }
    const untypedProducer = structuredClone(original)
    const producerGate = untypedProducer.history.find(gate => gate.kind === 'evaluated'
      && gate.analysis?.mode === 'producer')
    if (producerGate?.kind !== 'evaluated') throw new Error('test requires producer gate')
    delete producerGate.analysis
    expect(() => { validateIntakeHistory(untypedProducer) }).toThrow(/report producer gate must record its typed dispatch/)
    expect(() => parseAnalysisState({ ...analysisRun(), admission: implementationAdmission() }))
      .toThrow(/requires an admitted analysis run/)
  })

  it('rejects tampered candidate, challenge, attempt and Arbiter lineage on replay', async () => {
    const { dispatcher } = readyDispatcher((run, attempt) => Promise.resolve(criticResult(run, attempt, 'holds')))
    const original = (await drive(analysisRun(), dispatcher)).run
    const mutations: Array<(run: ConductorRun) => void> = [
      (run) => { run.reportCandidates[0]!.candidate.material_spans[0]!.end_line = 2 },
      (run) => { run.reportCandidates[0]!.producerChildId = run.analysisChallenges[0]!.criticChildId },
      (run) => { run.analysisChallenges[0]!.hash = '0'.repeat(64) },
      (run) => { run.analysisChallenges[0]!.challenge.summary = 'Changed after validation.' },
      (run) => { run.analysisChallenges[0]!.challenge.critic_attempt = 2 },
      (run) => { run.reportDecision!.challenge_hash = '0'.repeat(64) },
      (run) => {
        const gate = run.history.findLast(record => record.kind === 'evaluated')
        if (gate?.kind !== 'evaluated') throw new Error('test requires final gate')
        gate.basis = ['Forged reason.']
      },
      (run) => {
        const gate = run.history.findLast(record => record.kind === 'evaluated')
        if (gate?.kind !== 'evaluated') throw new Error('test requires final gate')
        gate.evidenceReviewed = ['forged-evidence']
      },
      (run) => {
        const gate = run.history.findLast(record => record.kind === 'evaluated')
        if (gate?.kind !== 'evaluated') throw new Error('test requires final gate')
        gate.stateUpdate = 'report blocked'
      },
      (run) => {
        const gate = run.history.findLast(record => record.kind === 'evaluated')
        if (gate?.kind !== 'evaluated') throw new Error('test requires final gate')
        gate.decision = 'escalate'
      },
      (run) => {
        const gate = run.history.find(record => record.kind === 'evaluated' && record.gate === 'C')
        if (gate?.kind !== 'evaluated' || gate.analysis === undefined) throw new Error('test requires critic gate')
        gate.analysis.criticAttempt = 2
      },
    ]
    for (const mutate of mutations) {
      const forged = structuredClone(original)
      mutate(forged)
      expect(() => parseRun(serializeRun(forged))).toThrow()
    }
  })
})
