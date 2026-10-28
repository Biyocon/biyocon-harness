/** Host-owned child presentation, bound to workflow ids and exact gate offsets. */
import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import type { ConductorRun } from '@deepseek-ai/dsh-conductor'
import type { ConductorChild, ConductorChildRole } from '@deepseek-ai/dsh-conductor/child-types'

/**
 * Observe only children from one exact workflow dispatch.
 * @param ctx - workflow event context.
 * @param parent - durable owner session.
 * @param workflow - concrete runtime workflow handle.
 * @param run - admitted Conductor run at dispatch.
 * @param role - runtime-selected specialist or internal worker.
 * @returns lifecycle observer cleanup.
 */
export function observeConductorChildren(
  ctx: Context, parent: Session, workflow: WorkflowRun, run: ConductorRun, role: ConductorChildRole,
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
    publish({ childId: child.childId, runId: run.runId, role, attempt: attempts.size + 1, historyOffset: run.history.length, status: 'running' })
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
 * @param run - checkpoint whose gate history was durably saved.
 */
export function publishChildGates(parent: Session, run: ConductorRun): void {
  const children = new Map<string, ConductorChild>()
  for (const event of parent.events) if (event.type === 'conductor/child') children.set(event.data.childId, event.data)
  const latestDispatch = new Map<string, ConductorChild>()
  for (const child of children.values()) latestDispatch.set(`${child.runId}/${child.role}/${child.historyOffset}`, child)
  for (const child of latestDispatch.values()) {
    if (child.runId !== run.runId || child.role === 'ralph' || child.gate !== undefined || child.status === 'running') continue
    const record = run.history[child.historyOffset]
    if (record?.kind !== 'evaluated' || record.origin !== undefined || record.stage !== child.role) continue
    const reworks = run.history.slice(0, child.historyOffset + 1).filter(gate => gate.kind === 'evaluated' && gate.gate === record.gate && gate.decision === 'rework').length
    parent.append('conductor/child', { ...child, gate: { id: record.gate, decision: record.decision, reworks, limit: run.budget.maxReworkPerGate } })
  }
}
