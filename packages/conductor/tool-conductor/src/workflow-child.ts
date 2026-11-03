/** One policy-scoped Conductor child over the workflow and subagent runtime. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SpecialistExecutionFailure } from '@deepseek-ai/dsh-conductor'
import type { ConductorRun, ConductorStage } from '@deepseek-ai/dsh-conductor'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import type { ObjectJsonSchema, ToolGuard, ToolRestriction } from '@deepseek-ai/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { analysisToolGuard, READ_TOOLS, toolGuardForStage, toolRestrictionForStage } from './capability.ts'
import { observeConductorChildren } from './children.ts'

const SPECIALIST_WORKFLOW_META = {
  name: 'conductor-specialist',
  description: 'Run one fresh Conductor specialist through the workflow engine.',
  phases: [{ title: 'Specialist', detail: 'One policy-scoped structured-output child.' }],
}

const SPECIALIST_WORKFLOW_SCRIPT = String.raw`
phase('Specialist')
return await agent(args.prompt, {
  label: args.label,
  schema: args.schema,
})
`

/** Host-only policies for a critic child; omitted for current producer dispatches. */
export interface WorkflowChildOptions {
  composeChildPrompt?: (sessionId: SessionId, prompt: string) => ContentBlock[]
  maxOutputTokensPerChild?: number
  childToolFilter?: ToolRestriction
  childToolGuard?: ToolGuard
}

/**
 * Run one fresh structured child and reject failed workflow execution.
 * @param ctx - registered workflow and subagent services.
 * @param providerName - selected fresh subagent provider.
 * @param parent - owning agent.
 * @param signal - dispatch cancellation signal.
 * @param stage - Conductor role for child attribution.
 * @param run - admitted run and capability policy.
 * @param prompt - workflow script input, optionally replaced before child start.
 * @param schema - structured result schema.
 * @param persona - role and protocol instructions.
 * @param childToolContribution - optional trusted stage tool.
 * @param options - optional host-only child policy.
 * @returns the structured child result.
 */
export async function runWorkflowChild(
  ctx: Context,
  providerName: string,
  parent: Agent,
  signal: AbortSignal,
  stage: ConductorStage,
  run: ConductorRun,
  prompt: string,
  schema: ObjectJsonSchema,
  persona: string,
  childToolContribution?: SubagentChildToolContribution,
  options?: WorkflowChildOptions,
): Promise<unknown> {
  const workflow: WorkflowRun = ctx.workflowEngine.start({
    script: SPECIALIST_WORKFLOW_SCRIPT,
    meta: SPECIALIST_WORKFLOW_META,
    args: { prompt, label: `conductor-${stage}`, schema },
    subagentProvider: providerName,
    maxTotalAgents: 1,
    parent,
    signal,
    childToolFilter: options?.childToolFilter ?? (run.admission.purpose === 'analysis' ? { allow: [...READ_TOOLS] } : toolRestrictionForStage(stage, run.executionAuthorization)),
    childToolGuard: options?.childToolGuard ?? (run.admission.purpose === 'analysis' ? analysisToolGuard : toolGuardForStage(stage, run.baseline, run.executionAuthorization)),
    childPersona: persona,
    ...childToolContribution === undefined ? {} : { childToolContribution },
    ...options?.composeChildPrompt === undefined ? {} : { composeChildPrompt: options.composeChildPrompt },
    ...options?.maxOutputTokensPerChild === undefined ? {} : { maxOutputTokensPerChild: options.maxOutputTokensPerChild },
  })
  const stopChildPresentation = observeConductorChildren(ctx, parent.session, workflow, run, stage as Exclude<ConductorStage, 'intake' | 'closeout' | 'report-complete'>)
  let childFailure: string | undefined
  let childStarted = false
  const completedTurns = new Set<SessionId>()
  const stopSessionObserving = ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/end' && event.data.reason.kind === 'completed') {
      completedTurns.add(session.id)
    } else if (event.type === 'turn/start' || event.type === 'turn/end') {
      completedTurns.delete(session.id)
    }
  })
  const stopObserving = ctx.on('workflow/agent-end', (info, child) => {
    if (info.id === workflow.id) childStarted = true
    // A completed turn without structured output is a report defect. The
    // subagent seam also reports it as failed, unlike its authoritative turn.
    if (info.id === workflow.id && child.outcome !== 'completed'
      && !(child.outcome === 'failed' && completedTurns.has(child.childId))) {
      childFailure = `Conductor ${stage} child ${child.outcome}`
    }
  })
  try {
    try {
      const result: WorkflowResult = await workflow.result
      if (childFailure !== undefined) throw new Error(childFailure)
      if (result.stopReason !== 'completed') {
        throw new Error(`Conductor ${stage} workflow stopped: ${result.stopReason}`)
      }
      return result.value
    } finally {
      try {
        await workflow.dispose()
      } finally {
        stopObserving()
        stopSessionObserving()
        stopChildPresentation()
      }
    }
  } catch (cause) {
    throw new SpecialistExecutionFailure(cause, stage, childStarted)
  }
}
