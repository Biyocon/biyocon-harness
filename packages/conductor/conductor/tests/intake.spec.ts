import { describe, expect, it, vi } from 'vitest'
import { admitIntake, createRun, drive, parseRun, serializeRun, validateResumable } from '../src/index.ts'
import type { ConductorStage } from '../src/index.ts'
import { acceptedReport, analysisReply, analysisRun, implementationAdmission } from './intake-fixtures.ts'

describe('Conductor phase-one intake and report completion', () => {
  it.each([
    ['detective', 'answer', ['detective', 'auditor', 'arbiter']],
    ['detective', 'recommendations', ['detective', 'strategist', 'auditor', 'arbiter']],
    ['strategist', 'answer', ['strategist', 'auditor', 'arbiter']],
    ['strategist', 'recommendations', ['strategist', 'auditor', 'arbiter']],
    ['devils-advocate', 'answer', ['devils-advocate', 'auditor', 'arbiter']],
    ['devils-advocate', 'recommendations', ['devils-advocate', 'auditor', 'arbiter']],
  ] as const)('reports %s/%s without execution or approval', async (entry, deliverable, expected) => {
    const called: string[] = []
    const approval = vi.fn(() => { throw new Error('Analysis must never request approval') })
    const result = await drive(analysisRun(entry, deliverable), {
      authorizeExecution: approval,
      dispatchSpecialist(stage, run) { called.push(stage); return Promise.resolve(analysisReply(run, stage)) },
      dispatchArbiter(run) { called.push('arbiter'); return Promise.resolve(acceptedReport(run)) },
    }, (run) => { expect(parseRun(serializeRun(run))).toEqual(run); return Promise.resolve() })
    expect(called).toEqual(expected)
    expect(approval).not.toHaveBeenCalled()
    expect(result.kind).toBe('report')
    expect(result.run).toMatchObject({ status: 'reported', currentStage: 'report-complete', baseline: null,
      executionAuthorization: null, baselineHistory: [], qualityExecutions: [] })
    expect(result.run.closeout).toBeUndefined()
    expect(result.run.decision).toBeUndefined()
    expect(() =>{  validateResumable(result.run) }).toThrow(/terminal/)
    expect(result.run.history.filter(gate => gate.kind === 'skipped').every(gate => gate.decision === 'skipped')).toBe(true)
  })

  it('repairs C → B → C and nested C → B → A → B → C without resetting budgets', async () => {
    const calls: ConductorStage[] = []
    let c = 0
    let b = 0
    const result = await drive(analysisRun('devils-advocate'), {
      authorizeExecution: () => { throw new Error('No analysis approval') },
      dispatchSpecialist(stage, run) {
        calls.push(stage)
        const reply = analysisReply(run, stage)
        if (stage === 'devils-advocate' && c++ === 0) {
          delete reply.candidate
          return Promise.resolve({ ...reply, status: 'rework', defect: 'plan' })
        }
        if (stage === 'strategist' && b++ === 0) return Promise.resolve({ ...reply, status: 'rework', defect: 'scope' })
        return Promise.resolve(reply)
      },
      dispatchArbiter: run => Promise.resolve(acceptedReport(run)),
    }, (run) => { expect(parseRun(serializeRun(run))).toEqual(run); return Promise.resolve() })
    expect(calls).toEqual(['devils-advocate', 'strategist', 'detective', 'strategist', 'devils-advocate', 'auditor'])
    expect(result.run.status).toBe('reported')
  })

  it('Auditor and Arbiter revisions require a fresh producer and a fresh audit', async () => {
    let produced = 0
    let audited = 0
    let arbitrated = 0
    const calls: string[] = []
    const result = await drive(analysisRun('strategist'), {
      authorizeExecution: () => { throw new Error('No analysis approval') },
      dispatchSpecialist(stage, run) {
        calls.push(stage)
        const reply = analysisReply(run, stage, `version-${stage === 'strategist' ? ++produced : produced}`)
        if (stage === 'auditor' && audited++ === 0) return Promise.resolve({ ...reply, status: 'rework' })
        return Promise.resolve(reply)
      },
      dispatchArbiter(run) { calls.push('arbiter'); return Promise.resolve({ ...acceptedReport(run), decision: arbitrated++ === 0 ? 'revise' : 'accept' }) },
    }, (run) => { expect(parseRun(serializeRun(run))).toEqual(run); return Promise.resolve() })
    expect(calls).toEqual(['strategist', 'auditor', 'strategist', 'auditor', 'arbiter', 'strategist', 'auditor', 'arbiter'])
    expect(result.run.reportCandidates).toHaveLength(3)
    expect(result.run.status).toBe('reported')
  })

  it('escalates the third malformed report at the same gate', async () => {
    const dispatch = vi.fn(() => Promise.resolve({}))
    const result = await drive(analysisRun(), { dispatchSpecialist: dispatch,
      dispatchArbiter: () => { throw new Error('Cannot reach Arbiter') },
      authorizeExecution: () => { throw new Error('Cannot request approval') },
    })
    expect(dispatch).toHaveBeenCalledTimes(3)
    expect(result.run.status).toBe('escalated')
    expect(result.run.history.map(gate => gate.decision)).toEqual(['rework', 'rework', 'escalate'])
    expect(parseRun(serializeRun(result.run))).toEqual(result.run)
  })

  it('escalates a Strategist request for authority immediately without approval', async () => {
    const approval = vi.fn()
    const result = await drive(analysisRun('strategist'), {
      authorizeExecution: approval,
      dispatchSpecialist: (stage, run) => Promise.resolve({ ...analysisReply(run, stage), change_requests: [{ target: 'authority', reason: 'Let me write files' }] }),
      dispatchArbiter: () => { throw new Error('Cannot reach Arbiter') },
    })
    expect(result.kind).toBe('blocked')
    expect(approval).not.toHaveBeenCalled()
    expect(result.run.history.at(-1)?.decision).toBe('escalate')
    expect(result.run.analysisReports).toEqual([])
  })

  it.each(['auditor', 'headsman', 'integrator', 'arbiter', 'ralph', 'intake', 'closeout'])('rejects forbidden entry %s before creating a run', (entry) => {
    expect(() => admitIntake({ purpose: 'analysis', entry, deliverable: 'answer', rationale: 'invalid' }, analysisRun().admission.materials)).toThrow(/entry/)
  })

  it.each([
    { purpose: 'verification', entry: 'detective' },
    { purpose: 'analysis', entry: 'detective' },
    { purpose: 'analysis', entry: 'detective', deliverable: 'implementation' },
    { purpose: 'implementation', entry: 'detective', deliverable: 'answer' },
  ])('rejects unsupported purpose/deliverable $purpose/$deliverable', (selection) => {
    expect(() => admitIntake({ ...selection, rationale: 'Assess the owner task.' }, analysisRun().admission.materials)).toThrow(/purpose|deliverable/)
  })

  it('uses record format 3 and rejects format 2 without migration', () => {
    const run = analysisRun()
    expect(run.recordFormatVersion).toBe(3)
    expect(() => parseRun(JSON.stringify({ ...run, recordFormatVersion: 2 }))).toThrow(/format 2.*expected 3/)
  })

  it('retains the full implementation authorization path while recording supplied-work skips', () => {
    for (const entry of ['detective', 'strategist', 'devils-advocate'] as const) {
      const original = analysisRun(entry)
      const admission = admitIntake({ purpose: 'implementation', entry, rationale: 'Owner-supplied scope and plan.',
        scopeSources: ['current-request'], planSources: ['current-request'],
      }, original.admission.materials)
      const run = createRun(original.runId, { objective: original.objective, authority: original.authority, admission })
      expect(run.currentStage).toBe(entry)
      expect(run.history.map(gate => gate.gate)).toEqual(entry === 'detective' ? [] : entry === 'strategist' ? ['A'] : ['A', 'B'])
      expect(parseRun(serializeRun(run))).toEqual(run)
    }
    expect(implementationAdmission().purpose).toBe('implementation')
  })
})
