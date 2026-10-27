/** Read-only report validation and the analysis producer/auditor/arbiter workflow. */
import type { AnalysisEnvelope, CapturedReport, ConductorRun, ConductorStage, ReportCandidate, ReportDecision, SpecialistProblem } from './types.ts'
import type { ConductorCheckpoint, ConductorDispatcher, ConductorOutcome } from './drive.ts'
import { contentHash, reportProducer } from './intake.ts'
import { recordGate } from './state.ts'

import { reportObject as object, reportTexts as texts } from './report-json.ts'


function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() === value && value.length > 0
}

/**
 * Hash a complete report candidate for immutable audit/version binding.
 * @param candidate - validated producer result.
 * @returns SHA-256 of the candidate's canonical field order.
 */
export function reportHash(candidate: ReportCandidate): string {
  return contentHash(JSON.stringify({ version: candidate.version, deliverable: candidate.deliverable,
    content: candidate.content, criteria: candidate.criteria.map(item => ({ criterion: item.criterion, outcome: item.outcome })),
    material_ids: candidate.material_ids,
    assumptions: candidate.assumptions, limitations: candidate.limitations }))
}

/**
 * Locate the fresh successful audit of the active candidate.
 * @param run - analysis run with retained report/audit lineage.
 * @returns the audit's SHA-256, or undefined before successful audit.
 */
export function currentAuditHash(run: ConductorRun): string | undefined {
  const candidate = run.reportCandidates.at(-1)
  const audit = run.analysisReports.findLast(report => report.stage === 'auditor' && report.status === 'ready'
    && report.candidate_hash === candidate?.hash)
  if (audit === undefined) return undefined
  // The run id is checked separately; the hash identifies the audited content.
  return contentHash(JSON.stringify({ purpose: audit.purpose, stage: audit.stage, deliverable: audit.deliverable,
    status: audit.status, summary: audit.summary, material_ids: audit.material_ids, blockers: audit.blockers,
    assumptions: audit.assumptions, limitations: audit.limitations, candidate_hash: audit.candidate_hash }))
}

function materialReferences(value: unknown, run: ConductorRun): boolean {
  return texts(value) && value.length > 0 && new Set(value).size === value.length
    && value.every(id => run.admission.materials.some(material => material.id === id))
}

/**
 * Validate a candidate at a model or durable boundary.
 * @param value - untrusted candidate.
 * @param run - admitted owner inputs and criteria.
 * @returns a diagnostic, or undefined for valid report content fields.
 */
export function candidateProblem(value: unknown, run: ConductorRun): string | undefined {
  if (!object(value) || Object.keys(value).some(key => !['version', 'deliverable', 'content', 'criteria', 'material_ids', 'assumptions', 'limitations'].includes(key))
    || !text(value.version) || !text(value.content) || run.admission.purpose !== 'analysis'
    || value.deliverable !== run.admission.deliverable || !materialReferences(value.material_ids, run)
    || !texts(value.assumptions) || !texts(value.limitations) || !Array.isArray(value.criteria)) return 'invalid analysis ReportCandidate'
  if (value.criteria.length !== run.acceptanceCriteria.length || value.criteria.some((item, index) => !object(item)
    || Object.keys(item).some(key => key !== 'criterion' && key !== 'outcome')
    || item.criterion !== run.acceptanceCriteria[index] || !text(item.outcome))) return 'report must assess the exact acceptance criteria'
  return undefined
}

/**
 * Reject analysis envelopes that request execution or violate report provenance.
 * @param value - structured output from an analysis specialist.
 * @param stage - dispatched read-only stage.
 * @param run - current report lineage.
 * @returns repairable report defect or immediate authority escalation.
 */
export function analysisEnvelopeProblem(value: unknown, stage: ConductorStage, run: ConductorRun): SpecialistProblem | undefined {
  const report = (message: string): SpecialistProblem => ({ kind: 'report', message })
  const authority = (message: string): SpecialistProblem => ({ kind: 'authority', message })
  if (!object(value)) return report('analysis specialist must return an object')
  if ((text(value.run_id) && value.run_id !== run.runId) || (text(value.purpose) && value.purpose !== 'analysis')) return authority('analysis report must belong to this run and purpose')
  if (['execution_baseline', 'executionAuthorization', 'allowedPaths', 'allowed_paths', 'quality_evidence_ids', 'change_requests', 'authorization'].some(key => key in value)) {
    return authority('analysis specialists cannot request execution authority, write paths or commands')
  }
  const keys = ['run_id', 'purpose', 'stage', 'deliverable', 'status', 'summary', 'material_ids', 'blockers', 'assumptions', 'limitations', 'defect', 'candidate', 'candidate_hash']
  if (Object.keys(value).some(key => !keys.includes(key)) || value.run_id !== run.runId || value.purpose !== 'analysis' || value.stage !== stage
    || run.admission.purpose !== 'analysis' || value.deliverable !== run.admission.deliverable
    || !['ready', 'rework', 'blocked', 'failed'].includes(String(value.status))
    || !text(value.summary) || !materialReferences(value.material_ids, run)
    || !texts(value.blockers) || !texts(value.assumptions) || !texts(value.limitations)
    || (value.defect !== undefined && (!text(value.defect) || !['scope', 'plan', 'report'].includes(value.defect)))) return report('malformed analysis specialist envelope')
  if (value.status === 'ready' && value.blockers.length > 0) return report('ready analysis report cannot carry blockers')
  const prerequisite = stage === 'auditor' ? reportProducer(run.admission) : stage
  if (value.defect === 'plan' && prerequisite === 'detective') return report('Detective analysis has no earlier planning prerequisite')
  if (stage === 'auditor') {
    if (value.candidate !== undefined || value.candidate_hash !== run.reportCandidates.at(-1)?.hash
      || value.candidate_hash === undefined) return report('analysis audit must reference the exact current report candidate')
  } else if (value.status === 'ready' && stage === reportProducer(run.admission)) {
    const problem = candidateProblem(value.candidate, run)
    if (problem !== undefined) return report(problem)
    const candidate = value.candidate as ReportCandidate
    if (run.reportCandidates.some(previous => previous.candidate.version === candidate.version)) return report('report rework requires a new candidate version')
  } else if (value.candidate !== undefined || value.candidate_hash !== undefined) {
    return report('only the admitted report producer may submit a ReportCandidate')
  }
  return undefined
}

/**
 * Validate the Arbiter's report-specific verdict and exact candidate/audit identities.
 * @param value - untrusted verdict; release GO/NO-GO is not valid here.
 * @param run - admitted report and fresh audit.
 * @returns repairable report defect or authority violation.
 */
export function reportDecisionProblem(value: unknown, run: ConductorRun): SpecialistProblem | undefined {
  if (object(value) && ((text(value.run_id) && value.run_id !== run.runId) || (text(value.purpose) && value.purpose !== 'analysis'))) {
    return { kind: 'authority', message: 'report decision must belong to this run and purpose' }
  }
  if (!object(value) || value.run_id !== run.runId || value.purpose !== 'analysis'
    || Object.keys(value).some(key => !['run_id', 'purpose', 'candidate_hash', 'audit_hash', 'decision', 'basis', 'evidence_reviewed', 'open_risks'].includes(key))
    || !['accept', 'revise', 'blocked'].includes(String(value.decision))
    || value.candidate_hash !== run.reportCandidates.at(-1)?.hash || value.candidate_hash === undefined
    || value.audit_hash !== currentAuditHash(run) || value.audit_hash === undefined
    || !texts(value.basis) || value.basis.length === 0 || !texts(value.evidence_reviewed) || value.evidence_reviewed.length === 0
    || !texts(value.open_risks)) return { kind: 'report', message: 'report decision requires accept/revise/blocked and the exact current candidate and audit' }
  return undefined
}

/**
 * Drive only read-only specialists, never execution approval or write-capable stages.
 * @param initial - admitted analysis run.
 * @param dispatcher - fresh-session specialist dispatcher.
 * @param checkpoint - durable writer before subsequent dispatch.
 * @returns a terminal reported result or an honest blocker.
 */
export async function driveAnalysis(
  initial: ConductorRun, dispatcher: ConductorDispatcher, checkpoint: ConductorCheckpoint,
): Promise<ConductorOutcome> {
  let current = initial
  while (true) {
    const stage = current.currentStage
    if (current.admission.purpose !== 'analysis' || !['detective', 'strategist', 'devils-advocate', 'auditor', 'arbiter'].includes(stage)
      || current.baseline !== null || current.executionAuthorization !== null || current.baselineHistory.length
      || current.qualityExecutions.length) throw new Error('Conductor analysis cannot dispatch execution, approval or command work')
    const raw = stage === 'arbiter' ? await dispatcher.dispatchArbiter(current) : await dispatcher.dispatchSpecialist(stage, current)
    const problem = stage === 'arbiter' ? reportDecisionProblem(raw, current) : analysisEnvelopeProblem(raw, stage, current)
    if (problem !== undefined) {
      current = recordGate(current, {
        decision: problem.kind === 'authority' ? 'escalate' : 'rework', defectClass: 'report', nextStage: stage,
        basis: [problem.message], evidenceReviewed: [], stateUpdate: `reject analysis ${problem.kind} problem`,
      })
      await checkpoint(current)
      if (current.status === 'rework') continue
      return { kind: 'blocked', blocker: problem.message, run: current }
    }
    if (stage === 'arbiter') {
      const decision = structuredClone(raw as ReportDecision)
      const accepted = decision.decision === 'accept'
      current = recordGate({ ...current, reportDecision: decision }, {
        decision: accepted ? 'pass' : decision.decision === 'revise' ? 'rework' : 'escalate',
        ...decision.decision === 'revise' ? { defectClass: 'analysis' as const, nextStage: reportProducer(current.admission) } : {},
        basis: decision.basis, evidenceReviewed: decision.evidence_reviewed, stateUpdate: `report ${decision.decision}`,
      })
      await checkpoint(current)
      if (current.status === 'rework') continue
      return accepted ? { kind: 'report', report: current.reportCandidates.at(-1) as CapturedReport, decision, run: current }
        : { kind: 'blocked', blocker: 'analysis report blocked or rework budget exhausted', run: current }
    }
    const envelope = structuredClone(raw as AnalysisEnvelope)
    let reportCandidates = current.reportCandidates
    if (envelope.status === 'ready' && envelope.candidate !== undefined) {
      const captured: CapturedReport = {
        producer: reportProducer(current.admission), candidate: envelope.candidate, hash: reportHash(envelope.candidate),
      }
      reportCandidates = [...reportCandidates, captured]
    }
    const repair = envelope.status === 'rework'
    const defect = envelope.defect ?? (stage === 'auditor' ? 'analysis' : 'report')
    const target = defect === 'scope' ? 'detective' : defect === 'plan' ? 'strategist'
      : defect === 'analysis' ? reportProducer(current.admission) : stage
    const assessed: ConductorRun = { ...current, reportCandidates, analysisReports: [...current.analysisReports, envelope] }
    delete assessed.reportDecision
    current = recordGate(assessed, {
      decision: envelope.status === 'ready' ? 'pass' : repair ? 'rework' : 'escalate',
      ...repair ? { defectClass: defect, nextStage: target } : {},
      basis: [envelope.summary], evidenceReviewed: envelope.material_ids, stateUpdate: envelope.summary,
    })
    await checkpoint(current)
    if (current.status === 'running' || current.status === 'rework') continue
    return { kind: 'blocked', blocker: `analysis ${current.status} at ${stage}`, run: current }
  }
}
