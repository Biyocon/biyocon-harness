import { describe, expect, it, vi } from 'vitest'
import { admitIntake, captureIntakeMaterial, closeRun, createRun, drive, parseRun, recordGate, serializeRun, validateResumable } from '../src/index.ts'
import type { ConductorRun } from '../src/index.ts'
import { analysisEnvelopeProblem, candidateProblem, driveAnalysis, reportDecisionProblem } from '../src/analysis.ts'
import { parseAdmission, transitionRoute } from '../src/intake.ts'
import { reworkTarget } from '../src/routing.ts'
import { acceptedReport, analysisReply, analysisRun, implementationAdmission } from './intake-fixtures.ts'

const materials = () => analysisRun().admission.materials
const validChoice = { purpose: 'analysis', entry: 'detective', deliverable: 'answer', rationale: 'Answer the current owner question.' }

async function reported() {
  return (await drive(analysisRun(), {
    authorizeExecution: () => { throw new Error('No analysis approval') },
    dispatchSpecialist: (stage, run) => Promise.resolve(analysisReply(run, stage)),
    dispatchArbiter: run => Promise.resolve(acceptedReport(run)),
  })).run
}

describe('Conductor admission rejects unsupported or unbound material', () => {
  it.each([null, [], {}, { ...validChoice, entry: undefined }, { ...validChoice, purpose: undefined },
    { ...validChoice, rationale: ' ' }, { ...validChoice, rationale: ' padded ' },
    { ...validChoice, dirtyDigests: [] }, { ...validChoice, scopeSources: ['invented-id'] },
    { ...validChoice, scopeSources: 'current-request' }, { ...validChoice, scopeSources: ['current-request', 'current-request'] },
    { ...validChoice, plan: [null] }, { ...validChoice, planSources: [''] },
  ])('rejects invalid model intake %j', (input) => {
    expect(() => admitIntake(input, materials())).toThrow(/Conductor/)
  })

  it('validates file captures and rejects forged or incompatible durable admission fields', () => {
    const admission = admitIntake(validChoice, [...materials(), captureIntakeMaterial('plan.md', 'A supplied plan.')])
    expect(parseAdmission(admission)).toEqual(admission)
    const corruptions: unknown[] = [
      { ...admission, profileVersion: 2 }, { ...admission, manifest: [] }, { ...admission, rationale: '' },
      { ...admission, materials: [] }, { ...admission, materials: null },
      { ...admission, scopeSources: ['unknown'] }, { ...admission, planSources: ['unknown'] },
      ...[
        { ...admission.materials[0], content: 'substitution' },
        { ...admission.materials[0], selector: 'other-request' },
        { ...admission.materials[0], sourceMessage: {} },
        { ...admission.materials[0], sourceMessage: { sessionId: 'parent', eventIndex: -1 } },
        { ...admission.materials[0], sourceMessage: { sessionId: 'parent', eventIndex: 1, token: 'forged' } },
        { ...admission.materials[0], extra: 'unsupported' },
        { ...admission.materials[0], content: ' ' },
      ].map(first => ({ ...admission, materials: [first, admission.materials[1]] })),
      ...['/outside', '../outside', 'a\\b', 'C:/outside', 'a//b', './a', 'current-request'].map(selector => ({
        ...admission, materials: [admission.materials[0], { ...admission.materials[1], selector }],
      })),
      { ...admission, materials: [admission.materials[0], { ...admission.materials[1],
        sourceMessage: admission.materials[0].sourceMessage }] },
      { ...admission, materials: [admission.materials[0], admission.materials[1], admission.materials[1]] },
    ]
    for (const corrupted of corruptions) expect(() => parseAdmission(corrupted), JSON.stringify(corrupted)).toThrow(/Conductor/)
  })
})

describe('Conductor analysis validation and recovery', () => {
  it.each(['scope', 'plan'] as const)('repairs insufficient %s before dispatch without inventing a specialist', async (defect) => {
    const original = analysisRun('devils-advocate')
    const admission = { ...original.admission, [defect === 'scope' ? 'scopeSources' : 'planSources']: [] }
    const run = createRun(original.runId, { admission, objective: original.objective, authority: original.authority,
      scope: original.scope, acceptanceCriteria: original.acceptanceCriteria })
    const called: string[] = []
    const result = await drive(run, {
      authorizeExecution: () => { throw new Error('No analysis approval') },
      dispatchSpecialist(stage, value) { called.push(stage); return Promise.resolve(analysisReply(value, stage)) },
      dispatchArbiter: value => Promise.resolve(acceptedReport(value)),
    }, (value) => { expect(parseRun(serializeRun(value))).toEqual(value); return Promise.resolve() })
    expect(called[0]).toBe(defect === 'scope' ? 'detective' : 'strategist')
    expect(result.run.history[2]).toMatchObject({ kind: 'evaluated', origin: 'intake-validation', gate: 'C', decision: 'rework', defectClass: defect })
    expect(result.run.status).toBe('reported')
  })

  it('resumes captured analysis after a checkpoint without rerunning intake or duplicating skips', async () => {
    let saved: ConductorRun | undefined
    await expect(drive(analysisRun(), {
      authorizeExecution: () => { throw new Error('No approval') },
      dispatchSpecialist: (stage, run) => Promise.resolve(analysisReply(run, stage)),
      dispatchArbiter: run => Promise.resolve(acceptedReport(run)),
    }, (run) => { saved = run; return Promise.reject(new Error('simulated process interruption')) })).rejects.toThrow(/interruption/)
    const recovered = parseRun(serializeRun(saved!))
    validateResumable(recovered)
    const calls: string[] = []
    const result = await drive(recovered, {
      authorizeExecution: () => { throw new Error('No approval') },
      dispatchSpecialist(stage, run) { calls.push(stage); return Promise.resolve(analysisReply(run, stage)) },
      dispatchArbiter(run) { calls.push('arbiter'); return Promise.resolve(acceptedReport(run)) },
    })
    expect(calls).toEqual(['auditor', 'arbiter'])
    expect(result.run.history.filter(gate => gate.gate === 'B')).toHaveLength(1)
  })

  it('keeps each gate budget independent and escalates a third Arbiter revision', async () => {
    let version = 0
    const result = await drive(analysisRun(), {
      authorizeExecution: () => { throw new Error('No approval') },
      dispatchSpecialist: (stage, run) => Promise.resolve(analysisReply(run, stage, `report-${++version}`)),
      dispatchArbiter: run => Promise.resolve({ ...acceptedReport(run), decision: 'revise' }),
    }, (run) => { expect(parseRun(serializeRun(run))).toEqual(run); return Promise.resolve() })
    expect(result.kind).toBe('blocked')
    expect(result.run.history.filter(gate => gate.gate === 'G').map(gate => gate.decision)).toEqual(['rework', 'rework', 'escalate'])
    expect(result.run.history.filter(gate => gate.gate === 'A').every(gate => gate.decision === 'pass')).toBe(true)
  })

  it.each(['blocked', 'failed'] as const)('retains honest %s specialist findings', async (status) => {
    const result = await drive(analysisRun(), {
      authorizeExecution: () => { throw new Error('No approval') },
      dispatchSpecialist: (stage, run) => Promise.resolve({ ...analysisReply(run, stage), status, candidate: undefined }),
      dispatchArbiter: () => { throw new Error('No Arbiter after blocker') },
    })
    expect(result.kind).toBe('blocked')
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
    expect(result.run.analysisReports[0]!.status).toBe(status)
  })

  it('requires a fresh version and a matching independent audit before a report verdict', async () => {
    const done = await reported()
    const candidate = done.reportCandidates[0]!.candidate
    expect(candidateProblem({ ...candidate, criteria: [{ criterion: 'unknown', outcome: 'passed' }] }, done)).toMatch(/criteria/)
    for (const value of [null, { ...candidate, deliverable: 'implementation' }, { ...candidate, material_ids: ['invented'] },
      { ...candidate, assumptions: [null] }, { ...candidate, criteria: [{ criterion: 'wrong', outcome: '' }] }]) {
      expect(candidateProblem(value, done)).toBeDefined()
    }
    expect(analysisEnvelopeProblem(analysisReply(done, 'detective'), 'detective', done)?.message).toMatch(/new candidate version/)
    expect(analysisEnvelopeProblem({ ...analysisReply(done, 'detective'), candidate: null }, 'detective', done)?.message).toMatch(/invalid analysis ReportCandidate/)
    expect(analysisEnvelopeProblem({ ...analysisReply(done, 'auditor'), candidate_hash: 'old' }, 'auditor', done)?.message).toMatch(/exact current/)
    expect(reportDecisionProblem({ ...acceptedReport(done), audit_hash: 'old' }, done)?.kind).toBe('report')
    expect(reportDecisionProblem({ ...acceptedReport(done), run_id: 'other' }, done)?.kind).toBe('authority')
    expect(reportDecisionProblem({ ...acceptedReport(done), purpose: 'implementation' }, done)?.kind).toBe('authority')
    expect(reportDecisionProblem({ ...acceptedReport(done), decision: 'go' }, done)?.kind).toBe('report')
  })

  it('retains an Arbiter blocker and a host abort without granting report or execution completion', async () => {
    const result = await drive(analysisRun(), {
      authorizeExecution: () => { throw new Error('No approval') },
      dispatchSpecialist: (stage, run) => Promise.resolve(analysisReply(run, stage)),
      dispatchArbiter: run => Promise.resolve({ ...acceptedReport(run), decision: 'blocked' }),
    })
    expect(result.kind).toBe('blocked')
    expect(parseRun(serializeRun(result.run)).status).toBe('escalated')
    const aborted = recordGate(analysisRun(), { decision: 'abort', basis: ['Owner stopped the analysis.'], evidenceReviewed: [], stateUpdate: 'abort' })
    expect(parseRun(serializeRun(aborted)).status).toBe('aborted')
  })

  it('repairs malformed report envelopes but escalates foreign run identity', () => {
    const run = analysisRun()
    const ready = analysisReply(run, 'detective')
    for (const value of [null, {}, { ...ready, status: 'ready', blockers: ['blocked'] }, { ...ready, purpose: undefined },
      { ...ready, extra: true }, { ...ready, defect: 'plan' }, { ...ready, defect: {} }, { ...ready, defect: 'implementation' }]) {
      expect(analysisEnvelopeProblem(value, 'detective', run)?.kind).toBe('report')
    }
    expect(analysisEnvelopeProblem({ ...ready, run_id: 'other' }, 'detective', run)?.kind).toBe('authority')
    expect(analysisEnvelopeProblem({ ...ready, purpose: 'implementation' }, 'detective', run)?.kind).toBe('authority')
    expect(analysisEnvelopeProblem({ ...ready, execution_baseline: {} }, 'detective', run)?.kind).toBe('authority')
    expect(analysisEnvelopeProblem({ ...ready, stage: 'strategist' }, 'strategist', run)?.message).toMatch(/only the admitted report producer/)
  })

  it('rejects execution and closeout even when an internal caller attempts an invalid analysis transition', async () => {
    const run = analysisRun()
    for (const stage of ['headsman', 'ralph', 'integrator', 'closeout'] as const) {
      expect(() => transitionRoute({ ...run, currentStage: stage }, 'pass')).toThrow(/execution stage/)
      expect(() => transitionRoute(run, 'rework', 'report', stage)).toThrow(/route into execution/)
    }
    const forbidden = { ...run, currentStage: 'headsman' as const }
    const dispatch = vi.fn()
    await expect(driveAnalysis(forbidden, { dispatchSpecialist: dispatch, dispatchArbiter: dispatch, authorizeExecution: dispatch },
      () => Promise.resolve())).rejects.toThrow(/cannot dispatch/)
    expect(dispatch).not.toHaveBeenCalled()
    expect(() => closeRun(run, {} as never)).toThrow(/cannot close out/)
    expect(() => recordGate({ ...run, executionAuthorization: {} as never }, { decision: 'pass', basis: [], evidenceReviewed: [], stateUpdate: '' })).toThrow(/cannot carry execution/)
    expect(() => reworkTarget('analysis', 'auditor')).toThrow(/admitted report producer/)
    expect(() => transitionRoute(run, 'rework')).toThrow(/defect class and target/)
    expect(() => transitionRoute(run, 'rework', 'report', 'strategist')).toThrow(/reporting stage/)
    expect(() => transitionRoute(run, 'rework', 'scope', 'strategist')).toThrow(/Detective/)
    expect(() => transitionRoute(run, 'rework', 'plan', 'detective')).toThrow(/Strategist/)
    expect(() => transitionRoute(run, 'rework', 'analysis', 'detective')).toThrow(/report producer/)
    expect(() => transitionRoute(run, 'rework', 'implementation', 'detective')).toThrow(/cannot rework/)
    expect(() => transitionRoute(run, 'rework', 'plan', 'strategist')).toThrow(/earlier prerequisite/)
    expect(() => transitionRoute({ ...run, currentStage: 'strategist' }, 'pass')).toThrow(/outside its admitted route/)
  })
})

describe('Conductor format 3 durable tamper rejection', () => {
  it('rejects forged gate metadata, admission repairs, budgets and evaluated gates in place of skips', () => {
    const original = analysisRun('devils-advocate')
    const gate = { kind: 'evaluated', gate: 'C', stage: 'devils-advocate', decision: 'rework',
      defectClass: 'report', nextStage: 'devils-advocate', basis: ['Malformed output'], evidenceReviewed: [], stateUpdate: 'repair' }
    for (const patch of [
      { history: [...original.history, { ...gate, origin: 'forged' }] },
      { history: [...original.history, { ...gate, origin: 'intake-validation' }, { ...gate, origin: 'intake-validation' }] },
      { history: [{ ...gate, gate: 'A', stage: 'detective', nextStage: 'detective' }] },
      { history: [...original.history, gate, gate, gate] },
      { history: [{ ...original.history[0], secretGrant: true }, original.history[1]] },
      { history: [...original.history, { ...gate, kind: 'unknown' }] },
    ]) {
      expect(() => parseRun(JSON.stringify({ ...original, status: 'rework', ...patch }))).toThrow(/Conductor|Analysis/)
    }
    const initial = analysisRun()
    const reply = analysisReply(initial, 'detective')
    const captured = { producer: 'detective', candidate: reply.candidate!, hash: 'irrelevant' }
    // A valid extra report is still invalid without its actual gate assessment.
    const completed = recordGate({ ...initial, analysisReports: [reply], reportCandidates: [captured as never] }, {
      decision: 'pass', basis: [], evidenceReviewed: [], stateUpdate: 'not the retained report',
    })
    expect(() => parseRun(serializeRun(completed))).toThrow()
  })
  it('rejects incompatible execution state, false lifecycle, candidate/audit hashes and forged skip history', async () => {
    const run = await reported()
    const mutations: Array<(record: ConductorRun) => void> = [
      (value) => { value.executionAuthorization = {} as never }, (value) => { value.baseline = {} as never },
      (value) => { value.specialistReports = [{} as never] }, (value) => { value.qualityExecutions = [{} as never] },
      (value) => { value.currentStage = 'headsman' }, (value) => { value.status = 'closed' },
      (value) => { value.analysisReports = [{} as never] }, (value) => { value.analysisReports[0]!.run_id = 'other' },
      (value) => { value.reportCandidates[0]!.hash = 'forged' }, (value) => { value.reportCandidates[0]!.producer = 'strategist' },
      (value) => { value.reportCandidates.push(value.reportCandidates[0]!) }, (value) => { value.reportCandidates = [] },
      (value) => { value.history[1] = { ...value.history[1]!, nextStage: 'headsman' } },
      (value) => { value.history[1] = { ...value.history[1]!, kind: 'evaluated' } as never },
      (value) => { value.history[1] = { ...value.history[1]!, executionBaselineHash: 'forged' } as never },
      (value) => { value.history[1] = { ...value.history[1]!, route: ['headsman'] } as never },
      (value) => { value.history[1] = { ...value.history[1]!, reason: 'supplied-work' } as never },
      (value) => { value.history[0] = { ...value.history[0]!, basis: ['forged'] } },
      (value) => { value.history[0] = { ...value.history[0]!, decision: 'rework', defectClass: 'report', nextStage: 'detective' } as never },
      (value) => { value.history[0] = { ...value.history[0]!, stateUpdate: 'invented report' } },
      (value) => { value.history = value.history.slice(1) }, (value) => { value.analysisReports = value.analysisReports.slice(1) },
      (value) => { value.analysisReports.push(structuredClone(value.analysisReports.at(-1)!)) },
      (value) => { value.history.push(value.history.at(-1)!) }, (value) => { value.status = 'running' },
      (value) => { value.reportDecision = { ...value.reportDecision!, audit_hash: 'old' } }, (value) => { delete value.reportDecision },
      (value) => { value.history[0] = { ...value.history[0]!, origin: 'intake-validation' } as never },
      (value) => { value.history[0] = { ...value.history[0]!, kind: 'unknown' } as never },
      (value) => { value.history[1] = { ...value.history[1]!, stateUpdate: null } as never },
    ]
    for (const mutate of mutations) {
      const corrupted = structuredClone(run)
      mutate(corrupted)
      expect(() => parseRun(serializeRun(corrupted)), serializeRun(corrupted)).toThrow(/conductor|analysis|reported/i)
    }
    const implementation = createRun(run.runId, {
      objective: run.objective, authority: run.authority, admission: implementationAdmission(),
    })
    expect(() => parseRun(JSON.stringify({ ...implementation, reportCandidates: run.reportCandidates }))).toThrow(/cannot carry analysis/)
    expect(() => parseRun(JSON.stringify({ ...implementation, manifest: [] }))).toThrow(/unsupported phase-one fields/)
    expect(() => parseRun(JSON.stringify({ ...implementation, history: [{ kind: 'unknown' }] })))
      .toThrow(/requires evaluated or skipped kind/)
  })
})
