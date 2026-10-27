/** Causal gate-history validation shared by both admitted workflow purposes. */
import type { ConductorRun, ConductorStage, GateId, RepairReturn } from './types.ts'
import { admittedRoute, GATED_STAGES, transitionRoute } from './intake.ts'

/**
 * Reject forged skips, invalid causal returns, reset budgets and impossible stages.
 * @param run - structurally parsed durable run.
 */
export function validateIntakeHistory(run: ConductorRun): void {
  const order = GATED_STAGES as readonly ConductorStage[]
  const route = admittedRoute(run.admission)
  let currentStage: ConductorStage = 'detective'
  let destination: ConductorStage = run.admission.entry
  let repairReturns: RepairReturn[] = []
  let evaluated = false
  let terminal = false
  const counts = new Map<GateId, number>()
  for (const gate of run.history) {
    // Discriminants and optional origin still come from durable JSON here.
    const metadata = gate as { kind: unknown; decision: unknown; origin?: unknown }
    if (terminal) throw new Error('Conductor history cannot continue after a terminal gate')
    const keys = gate.kind === 'skipped'
      ? ['kind', 'gate', 'stage', 'decision', 'reason', 'purpose', 'deliverable', 'route', 'basis', 'evidenceReviewed', 'stateUpdate', 'nextStage']
      : ['kind', 'gate', 'stage', 'decision', 'origin', 'defectClass', 'executionBaselineHash', 'basis', 'evidenceReviewed', 'stateUpdate', 'nextStage']
    if (Object.keys(gate).some(key => !keys.includes(key))) throw new Error('Conductor gate history contains unsupported fields')
    const index = order.indexOf(currentStage)
    if (index < 0 || gate.stage !== currentStage || gate.gate !== 'ABCDEFG'[index]) {
      throw new Error('Conductor history stage/gate does not follow its admitted causal route')
    }
    if (gate.kind === 'skipped') {
      const reason = evaluated ? 'profile-not-applicable' : 'supplied-work'
      if (currentStage === destination || metadata.decision !== 'skipped' || gate.nextStage !== order[index + 1]
        || gate.reason !== reason || gate.purpose !== run.admission.purpose
        || gate.deliverable !== (run.admission.purpose === 'analysis' ? run.admission.deliverable : undefined)
        || JSON.stringify(gate.route) !== JSON.stringify(route)
        || JSON.stringify(gate.basis) !== JSON.stringify([run.admission.rationale])
        || JSON.stringify(gate.evidenceReviewed) !== JSON.stringify(run.admission.materials.map(material => material.id))
        || (evaluated && route.includes(currentStage))
        || (!evaluated && index >= order.indexOf(run.admission.entry))) {
        throw new Error('Conductor skipped gate lacks a valid supplied-work or profile justification')
      }
      currentStage = gate.nextStage
      continue
    }
    if (metadata.kind !== 'evaluated' || currentStage !== destination) throw new Error('Conductor evaluated gate bypasses required skip records')
    if (metadata.origin !== undefined && (metadata.origin !== 'intake-validation' || evaluated || gate.decision !== 'rework')) {
      throw new Error('Conductor admission repair must precede specialist evaluation')
    }
    evaluated = true
    terminal = gate.decision === 'abort' || gate.decision === 'escalate' || gate.gate === 'G' && gate.decision === 'pass'
    if (gate.decision === 'rework') {
      const count = (counts.get(gate.gate) ?? 0) + 1
      if (count > run.budget.maxReworkPerGate) throw new Error('Conductor gate exceeds its per-gate rework budget')
      counts.set(gate.gate, count)
    }
    const transition = transitionRoute({ admission: run.admission, currentStage, repairReturns }, gate.decision, gate.defectClass,
      gate.decision === 'pass' ? undefined : gate.nextStage)
    repairReturns = transition.repairReturns
    destination = transition.nextStage ?? currentStage
    const nextIndex = order.indexOf(destination)
    const immediate = gate.decision === 'pass' && nextIndex > index + 1 ? order[index + 1] : transition.nextStage
    if (gate.nextStage !== immediate) throw new Error('Conductor gate successor does not match its admitted transition')
    currentStage = immediate ?? currentStage
  }
  if (currentStage !== destination || run.currentStage !== currentStage
    || JSON.stringify(repairReturns) !== JSON.stringify(run.repairReturns)) {
    throw new Error('Conductor current stage or pending repairs do not match its complete gate history')
  }
}
