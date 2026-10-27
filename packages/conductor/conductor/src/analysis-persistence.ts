/** Strict durable parsing for read-only report runs, separate from execution evidence. */
import type { AnalysisEnvelope, ConductorRun } from './types.ts'
import { analysisEnvelopeProblem, reportDecisionProblem, reportHash } from './analysis.ts'
import { reportProducer } from './intake.ts'
import { validateIntakeHistory } from './intake-history.ts'

import { reportObject as object, reportTexts as texts } from './report-json.ts'


/**
 * Validate all analysis-specific fields and replay report/audit provenance.
 * @param record - run whose common owner, admission and budget fields are already parsed.
 * @returns the fully validated read-only run.
 */
export function parseAnalysisState(record: Record<string, unknown>): ConductorRun {
  if (record.baseline !== null || record.executionAuthorization !== null || record.decision !== undefined || record.closeout !== undefined
    || !Array.isArray(record.baselineHistory) || record.baselineHistory.length
    || !Array.isArray(record.qualityExecutions) || record.qualityExecutions.length
    || !Array.isArray(record.specialistReports) || record.specialistReports.length) {
    throw new Error('Conductor analysis record cannot carry execution baselines, authorization, quality work or closeout')
  }
  if (!['running', 'rework', 'escalated', 'aborted', 'reported'].includes(String(record.status))
    || !['detective', 'strategist', 'devils-advocate', 'auditor', 'arbiter', 'report-complete'].includes(String(record.currentStage))
    || !Array.isArray(record.history) || !Array.isArray(record.repairReturns)
    || !Array.isArray(record.analysisReports) || !Array.isArray(record.reportCandidates)) {
    throw new Error('Conductor analysis record has invalid lifecycle fields')
  }
  const run = record as unknown as ConductorRun
  const reconstructed: ConductorRun = { ...run, analysisReports: [], reportCandidates: [] }
  let candidateIndex = 0
  for (const value of record.analysisReports) {
    if (!object(value) || !['detective', 'strategist', 'devils-advocate', 'auditor'].includes(String(value.stage))) {
      throw new Error('Conductor analysis record contains an invalid specialist stage')
    }
    const problem = analysisEnvelopeProblem(value, value.stage as AnalysisEnvelope['stage'], reconstructed)
    if (problem !== undefined) throw new Error(`Conductor analysis record: ${problem.message}`)
    const envelope = value as unknown as AnalysisEnvelope
    if (envelope.status === 'ready' && envelope.candidate !== undefined) {
      const captured: unknown = record.reportCandidates[candidateIndex++]
      if (!object(captured) || Object.keys(captured).some(key => !['producer', 'candidate', 'hash'].includes(key))
        || captured.producer !== reportProducer(run.admission) || captured.producer !== envelope.stage
        || captured.hash !== reportHash(envelope.candidate)
        || JSON.stringify(captured.candidate) !== JSON.stringify(envelope.candidate)) {
        throw new Error('Conductor report candidate does not match its producer and exact content hash')
      }
      reconstructed.reportCandidates.push(captured as unknown as ConductorRun['reportCandidates'][number])
    }
    reconstructed.analysisReports.push(envelope)
  }
  if (candidateIndex !== record.reportCandidates.length) throw new Error('Conductor analysis record has unproduced report candidates')
  let reportIndex = 0
  for (const gate of record.history) {
    if (!object(gate) || !texts(gate.basis) || !texts(gate.evidenceReviewed) || typeof gate.stateUpdate !== 'string') {
      throw new Error('Conductor analysis gate history is malformed')
    }
    if (gate.kind === 'skipped') {
      if (gate.executionBaselineHash !== undefined || gate.defectClass !== undefined) throw new Error('Skipped analysis gate cannot carry execution or repair fields')
      continue
    }
    if (gate.kind !== 'evaluated' || !['pass', 'rework', 'escalate', 'abort'].includes(String(gate.decision))
      || gate.executionBaselineHash !== undefined) throw new Error('Analysis gate must be an evaluated report decision without execution authority')
    if (gate.stage === 'arbiter' || gate.origin === 'intake-validation') continue
    const report = run.analysisReports[reportIndex]
    if (report !== undefined && report.stage === gate.stage && report.summary === gate.stateUpdate) {
      const expected = report.status === 'ready' ? 'pass' : report.status === 'rework' ? 'rework' : 'escalate'
      if ((gate.decision !== expected && !(expected === 'rework' && gate.decision === 'escalate'))
        || JSON.stringify(gate.basis) !== JSON.stringify([report.summary])
        || JSON.stringify(gate.evidenceReviewed) !== JSON.stringify(report.material_ids)) throw new Error('Analysis gate does not assess its retained specialist report')
      reportIndex++
    } else if (gate.decision === 'pass') {
      throw new Error('Analysis gate pass requires a retained specialist report')
    }
  }
  if (reportIndex !== run.analysisReports.length) throw new Error('Conductor analysis reports do not follow their evaluated gate history')
  validateIntakeHistory(run)
  const last = run.history.findLast(gate => gate.kind === 'evaluated')
  const status = last === undefined ? 'running' : last.decision === 'pass'
    ? last.gate === 'G' ? 'reported' : 'running'
    : last.decision === 'rework' ? 'rework' : last.decision === 'abort' ? 'aborted' : 'escalated'
  if (run.status !== status) throw new Error('Conductor analysis status does not match its last evaluated gate')
  if (run.reportDecision !== undefined) {
    const problem = reportDecisionProblem(run.reportDecision, run)
    if (problem !== undefined || last?.gate !== 'G'
      || (run.reportDecision.decision === 'accept' ? last.decision !== 'pass' : last.decision === 'pass')) {
      throw new Error('Conductor analysis report decision does not match its audit or final gate')
    }
  }
  if (run.status === 'reported' && (run.currentStage !== 'report-complete' || run.reportDecision?.decision !== 'accept')) {
    throw new Error('Reported Conductor run requires report-complete and an accepted audited report')
  }
  return run
}
