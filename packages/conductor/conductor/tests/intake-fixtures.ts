import { SessionId } from '@deepseek-ai/dsh-session'
import { admitIntake, captureIntakeMaterial, ConductorRunId, createRun, currentAuditHash } from '../src/index.ts'
import type { AnalysisEnvelope, ConductorEntry, ConductorRun, ReportDeliverable } from '../src/index.ts'

export function implementationAdmission() {
  return admitIntake({ purpose: 'implementation', entry: 'detective', rationale: 'New owner task.' }, [
    captureIntakeMaterial('current-request', 'Implement the owner task.', { sessionId: SessionId('test-parent'), eventIndex: 0 }),
  ])
}

export function analysisRun(entry: ConductorEntry = 'detective', deliverable: ReportDeliverable = 'answer'): ConductorRun {
  return createRun(ConductorRunId('CON-2026-0030'), {
    objective: 'Review the supplied plan.', authority: { owner: 'user' },
    scope: ['the supplied plan'], acceptanceCriteria: ['Assess the supplied plan from its captured material.'],
    admission: admitIntake({ purpose: 'analysis', entry, deliverable, rationale: 'Assess supplied owner work.',
      scopeSources: ['current-request'], planSources: ['current-request'], plan: ['Assess the provided evidence.'],
    }, [captureIntakeMaterial('current-request', 'Review the supplied plan.', { sessionId: SessionId('test-parent'), eventIndex: 0 })]),
  })
}

export function analysisReply(run: ConductorRun, stage: string, version = 'report-v1'): AnalysisEnvelope {
  if (run.admission.purpose !== 'analysis') throw new Error('test requires analysis')
  const producer = run.admission.entry === 'detective' && run.admission.deliverable === 'recommendations' ? 'strategist' : run.admission.entry
  return {
    run_id: run.runId, purpose: 'analysis', stage: stage as AnalysisEnvelope['stage'], deliverable: run.admission.deliverable,
    status: 'ready', summary: `${stage} assessment ${version}`, material_ids: run.admission.materials.map(material => material.id),
    blockers: [], assumptions: [], limitations: [],
    ...stage === 'auditor' ? { candidate_hash: run.reportCandidates.at(-1)!.hash } : {},
    ...stage === producer ? { candidate: { version, deliverable: run.admission.deliverable,
      content: 'The analysis finds a documentation gap; no implementation or verification was performed.',
      criteria: run.acceptanceCriteria.map(criterion => ({ criterion, outcome: 'Assessed from cited material.' })),
      material_ids: run.admission.materials.map(material => material.id), assumptions: [], limitations: ['Static analysis only.'],
    } } : {},
  }
}

export function acceptedReport(run: ConductorRun) {
  return { run_id: run.runId, purpose: 'analysis' as const, decision: 'accept' as const,
    candidate_hash: run.reportCandidates.at(-1)!.hash, audit_hash: currentAuditHash(run)!,
    basis: ['The report and independent audit address the owner question.'],
    evidence_reviewed: [run.reportCandidates.at(-1)!.hash, currentAuditHash(run)!], open_risks: [],
  }
}
