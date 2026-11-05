/** Host-owned child presentation, bound to workflow ids and exact gate offsets. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { ConductorRun } from '@deepseek-ai/dsh-conductor'
import type { ConductorChild, ConductorChildRole } from '@deepseek-ai/dsh-conductor/child-types'

/** Analysis dispatch identity logged beside the runtime-selected role. */
type AnalysisDispatchIdentity = { mode: 'producer'; criticAttempt?: never } | { mode: 'critic'; criticAttempt: number }

/**
 * Observe only children from one exact workflow dispatch.
 * @param ctx - workflow event context.
 * @param parent - durable owner session.
 * @param workflow - concrete runtime workflow handle.
 * @param run - admitted Conductor run at dispatch.
 * @param role - runtime-selected specialist or internal worker.
 * @param dispatch - analysis producer or critic identity, if applicable.
 * @returns lifecycle observer cleanup.
 */
export function observeConductorChildren(
  ctx: Context, parent: Session, workflow: WorkflowRun, run: ConductorRun, role: ConductorChildRole,
  dispatch?: AnalysisDispatchIdentity,
): () => void {
  const children = new Map<string, ConductorChild>()
  const publish = (child: ConductorChild): void => {
    children.set(child.childId, child)
    parent.append('conductor/child', child)
  }
  const start = ctx.on('workflow/agent-start', (info, child) => {
    if (info.id !== workflow.id) return
    const attempts = new Set<string>()
    for (const event of parent.events) if (event.type === 'conductor/child'
      && event.data.runId === run.runId && event.data.role === role) attempts.add(event.data.childId)
    publish({ childId: child.childId, runId: run.runId, role,
      ...dispatch === undefined ? {} : dispatch, attempt: attempts.size + 1,
      historyOffset: run.history.length, status: 'running' })
  })
  const end = ctx.on('workflow/agent-end', (info, child) => {
    if (info.id !== workflow.id) return
    const previous = children.get(child.childId)
    if (previous !== undefined) publish({ ...previous, status: child.outcome === 'completed' ? 'completed' : 'failed' })
  })
  return () => {
    start(); end()
    for (const child of children.values()) if (child.status === 'running') publish({ ...child, status: 'failed' })
  }
}

/**
 * Attach a new runtime verdict only to the child dispatched for that history position.
 * @param parent - owner session containing the child ledger.
 * @param run - validated checkpoint whose gate events share its subsequent durable flush.
 */
export function publishChildGates(parent: Session, run: ConductorRun): void {
  const children = new Map<string, ConductorChild>()
  for (const event of parent.events) if (event.type === 'conductor/child') children.set(event.data.childId, event.data)
  const latestDispatch = new Map<string, ConductorChild>()
  for (const child of children.values()) latestDispatch.set(`${child.runId}/${child.role}/${child.historyOffset}`, child)
  for (const [offset, record] of run.history.entries()) {
    if (record.kind !== 'evaluated' || record.origin !== undefined) continue
    const child = record.analysis === undefined
      ? latestDispatch.get(`${run.runId}/${record.stage}/${offset}`)
      : record.analysis.childId === undefined ? undefined : children.get(record.analysis.childId)
    if (child === undefined || child.runId !== run.runId || child.role === 'ralph'
      || child.role !== record.stage || child.historyOffset !== offset
      || child.gate !== undefined || child.status === 'running') continue
    if (record.analysis !== undefined && (record.analysis.mode !== child.mode
      || record.analysis.criticAttempt !== child.criticAttempt)) continue
    const reworks = run.history.slice(0, offset + 1).filter(gate => gate.kind === 'evaluated' && gate.gate === record.gate && gate.decision === 'rework').length
    const captured = run.analysisChallenges.find(challenge => challenge.hash === record.analysis?.challengeHash
      && challenge.candidateHash === record.analysis.candidateHash
      && challenge.criticChildId === child.childId && challenge.criticAttempt === child.criticAttempt)
    parent.append('conductor/child', { ...child, gate: { id: record.gate, decision: record.decision,
      reworks, limit: run.budget.maxReworkPerGate,
      ...record.analysis?.conclusion === undefined ? {} : { challengeConclusion: record.analysis.conclusion },
      ...captured === undefined ? {} : { challenge: {
        hash: captured.hash, result: structuredClone(captured.challenge),
      } } } })
  }
}
