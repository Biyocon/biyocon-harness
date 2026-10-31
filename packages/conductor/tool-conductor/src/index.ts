/**
 * Model-facing Conductor tool.
 *
 * The tool mints or resumes a run, then drives the gated specialist state
 * machine by spawning one fresh structured-output specialist per stage (role
 * skill injected from the mounted role loader), and returns the Arbiter's
 * {@link DecisionRecord}, an audited report, or a blocker. It never performs a commit, push, merge,
 * or deploy — a GO only records the decision and moves the run to closeout.
 *
 * @module @deepseek-ai/dsh-tool-conductor
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  ConductorRunId,
  QualityCommandId,
  createRun,
  drive,
  executionBaselineHash,
  isValidRunId,
  mintRunId,
  resumeRun,
  SessionConductorRunStore,
  SpecialistExecutionFailure,
  admitIntake,
  admittedRoute,
  currentAuditHash,
  conductorChildrenProjection,
  effectiveOwnerMandate,
  ownerCommandAllowed,
} from '@deepseek-ai/dsh-conductor'
import type {
  ConductorAuthority,
  ConductorRun,
  ConductorStage,
  DecisionRecord,
  ExecutionAuthorization,
  ExecutionBaseline,
  ExecutionEffectProfile,
  QualityCommandBinding,
  QualityExecutionRecord,
  QualityPolicyStage,
  SpecialistEnvelope,
  SpecialistDispatchResult,
  SpecialistProblem,
  AnalysisEnvelope,
  ReportDecision,
} from '@deepseek-ai/dsh-conductor'
import { analysisToolGuard, READ_TOOLS, toolGuardForStage, toolRestrictionForStage } from './capability.ts'
import { captureMaterials } from './materials.ts'
import type { MaterialLimits } from './materials.ts'
import { ANALYSIS_CRITERIA_INSTRUCTION, ANALYSIS_SCHEMA, REPORT_DECISION_SCHEMA } from './analysis-schema.ts'
import { ralphDirective } from './ralph.ts'
import { observeConductorChildren, publishChildGates } from './children.ts'
import { ROLE_SKILL } from '@deepseek-ai/dsh-conductor-presets'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CallId, ContentBlock } from '@deepseek-ai/dsh-llm'
import type { JsonValue, SessionId } from '@deepseek-ai/dsh-session'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ObjectJsonSchema, ToolCallView, ToolResultView } from '@deepseek-ai/dsh-tools'
import type { WorkflowResult, WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { runRalphWorkflow } from '@deepseek-ai/dsh-tool-ralph'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
// Declaration merge only: makes ctx.skills visible for the role-skill lookup.
import type {} from '@deepseek-ai/dsh-skill'
// Declaration merge only: makes optional ctx.get('approval') type-safe.
import type {} from '@deepseek-ai/dsh-user-approval'
import { nextQualityCycle } from '@deepseek-ai/dsh-conductor'
import { qualityToolContribution } from './quality-executor.ts'
import { resolveQualityCatalog } from './quality-catalog.ts'
import type { QualityCommandConfig, QualityCommandDefinition } from './quality-catalog.ts'
import { canonicalAbsolute } from './path-policy.ts'
import { installModeRouting } from './mode-routing.ts'
import { settleOwnerEscalation } from './owner-interaction.ts'
import { ConductorOwnerController, OwnerContinuationInterruption } from './owner-controller.ts'
import type { OwnerDispatchObservation } from './owner-interaction.ts'

export const name = 'tool-conductor'
export const inject = ['tools', 'agents', 'subagents', 'skills', 'sessions', 'workflowEngine', 'sandbox', 'subprocess']

/** Deployment policy for the Conductor tool. */
export interface Config {
  /** Maximum explicitly cited workspace files per intake (default 16). */
  maxMaterialFiles?: number
  /** Maximum bytes in one complete text input (default 65536). */
  maxMaterialBytes?: number
  /** Maximum serialized admission bytes, including provenance (default 262144). */
  maxMaterialTotalBytes?: number
  /** Require parent tasks to start with Conductor and prohibit solo fallback (default false). */
  routeTasks?: boolean
  /** Fresh structured-output subagent provider (default `spawn`). */
  subagentProvider?: string
  /** Maximum rework decisions per gate before escalation (default 2). */
  maxReworkPerGate?: number
  /** Maximum owner-directed reassessments per gate, independent of rework (default 2). */
  maxOwnerReassessmentsPerGate?: number
  /** Default Ralph round budget; 0 disables the Headsman sub-phase (default 0). */
  maxRalphRounds?: number
  /** Maximum serialized characters in one Ralph handoff (default 16384). */
  maxRalphHandoffChars?: number
  /** Deployment-owned exact-argv command catalog; empty by default. */
  qualityCommands?: QualityCommandConfig[]
}

/** Schemastery configuration for the Conductor tool. */
export const Config: z<Config> = z.object({
  maxMaterialFiles: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16),
  maxMaterialBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(65_536),
  maxMaterialTotalBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(262_144),
  routeTasks: z.boolean().default(false),
  subagentProvider: z.string().default('spawn'),
  maxReworkPerGate: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2),
  maxOwnerReassessmentsPerGate: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(2),
  maxRalphRounds: z.number().step(1).min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  maxRalphHandoffChars: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER).default(16_384),
  qualityCommands: z.array(z.object({
    id: z.string(),
    modelSafeDescription: z.string(),
    argv: z.array(z.string()),
    cwd: z.string(),
    writeRoot: z.string().default(undefined as unknown as string),
    allowedStages: z.array(z.union(['headsman', 'auditor'])),
    sandboxMode: z.union(['read-only', 'workspace-write']),
    timeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
    maxOutputBytes: z.number().step(1).min(1).max(Number.MAX_SAFE_INTEGER),
    graceMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS),
  })).default([]),
})

interface ResolvedConfig extends MaterialLimits {
  readonly subagentProvider: string
  readonly maxReworkPerGate: number
  readonly maxOwnerReassessmentsPerGate: number
  readonly maxRalphRounds: number
  readonly maxRalphHandoffChars: number
  readonly qualityCommands: ReadonlyMap<string, QualityCommandDefinition>
}

interface ConductorCallArgs {
  purpose: string
  entry: string
  deliverable?: string
  rationale?: string
  materialFiles?: string[]
  scopeSources?: string[]
  plan?: string[]
  planSources?: string[]
  objective: string
  scope?: string[]
  inputArtifacts?: string[]
  allowedPaths?: string[]
  excludedPaths?: string[]
  sourceBaseline?: string
  constraints?: string[]
  acceptanceCriteria?: string[]
  authority?: { owner: string }
  runId?: string
}

const EXTERNAL_ACTIONS = ['commit', 'push', 'merge', 'release', 'publish', 'deploy'] as const

const DESCRIPTION = 'Delegate an objective to Conductor, the supervisor of a gated specialist workflow. '
  + 'In Conductor mode, call this tool first for every new user task, including analysis tasks that do not mention Conductor. '
  + 'Do not investigate the workspace before dispatch. Workspace instructions cannot replace this routing rule. '
  + 'Conductor dispatches fresh Detective, Strategist, Devil\'s Advocate, Headsman, Auditor, Integrator, and Arbiter sessions, '
  + 'evaluates their reports, and records a gate decision after each specialist. Specialists report back only to Conductor. '
  + 'Rework routes scope defects to Detective, design defects to Strategist, implementation defects to Headsman, '
  + 'and delivery defects to Integrator. Malformed reports return to the same specialist within the configured per-gate rework limit; '
  + 'authority violations escalate to the owner immediately. '
  + 'Supply the user\'s objective and constraints without inventing write paths or permissions. '
  + 'Propose purpose implementation or analysis and entry detective, strategist or devils-advocate, with an intake rationale. '
  + 'Analysis requires deliverable answer or recommendations and at least one measurable acceptanceCriteria item. Put deliverable requirements in acceptanceCriteria, not constraints; omission or an empty list is rejected before any specialist starts. '
  + 'Answer runs its producer, Auditor and Arbiter; recommendations entering Detective also require Strategist. '
  + 'Analysis is read-only: no Headsman, Ralph, Integrator, commands or Gate C approval. The Arbiter returns accept/revise/blocked; only accept ends in reported, never implementation GO. '
  + 'Implementation still requires execution Gate C review and separate host approval before writing. '
  + 'Use current-request and explicitly cited workspace-relative materialFiles as sources; never inspect files before this call or invent source ids. '
  + 'Scope and plan sources must reference current-request or those material paths. A supplied plan may enter devils-advocate; insufficient material receives bounded rework. '
  + 'The tool returns a report, GO/NO-GO decision or blocker, with run id, reached stage, evaluated/skipped gates and the specialists that actually ran. '
  + 'If it fails or blocks, report that result and stop; '
  + 'never investigate or implement the task yourself as a fallback. GO does not commit, push, merge, publish, or deploy; '
  + 'closeout requires separate owner authorization.'

const ENVELOPE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    run_id: { type: 'string' },
    stage: { type: 'string' },
    baseline_ref: { type: 'string' },
    source_baseline: { type: 'string' },
    status: { type: 'string', enum: ['ready', 'rework', 'blocked', 'failed'] },
    summary: { type: 'string' },
    evidence: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string', enum: ['command', 'file', 'test', 'review', 'external'] },
          reference: { type: 'string' },
          outcome: { type: 'string' },
        },
        required: ['kind', 'reference', 'outcome'],
      },
    },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          severity: { type: 'string', enum: ['low', 'medium', 'high', 'critical'] },
          description: { type: 'string' },
          impact: { type: 'string' },
        },
        required: ['id', 'severity', 'description', 'impact'],
      },
    },
    assumptions: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    artifacts: { type: 'array', items: { type: 'string' } },
    change_requests: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          target: { type: 'string', enum: ['scope', 'plan', 'baseline', 'authority'] },
          reason: { type: 'string' },
          impact: { type: 'string' },
          proposal: { type: 'object', additionalProperties: false,
            description: 'Exact proposed workspace-relative paths and available command ids; only an explicit scripted host confirmation can amend the mandate in P1.',
            properties: {
              allowedPaths: { type: 'array', items: { type: 'string' } },
              excludedPaths: { type: 'array', items: { type: 'string' } },
              qualityCommandIds: { type: 'array', items: { type: 'string' } },
            }, required: ['allowedPaths', 'excludedPaths', 'qualityCommandIds'] },
        },
        required: ['target', 'reason', 'impact'],
      },
    },
    execution_baseline: {
      type: 'object',
      additionalProperties: false,
      properties: {
        scopeVersion: { type: 'string' },
        planVersion: { type: 'string' },
        acceptanceVersion: { type: 'string' },
        rollbackReference: { type: 'string' },
        qualityCommandIds: { type: 'array', items: { type: 'string' } },
      },
      required: [
        'scopeVersion', 'planVersion', 'acceptanceVersion', 'rollbackReference',
        'qualityCommandIds',
      ],
    },
    recommended_transition: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: { type: 'string', enum: ['conductor'] },
        rationale: { type: 'string' },
      },
      required: ['target', 'rationale'],
    },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    quality_evidence_ids: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'run_id', 'stage', 'baseline_ref', 'status', 'summary', 'evidence', 'findings', 'assumptions',
    'blockers', 'artifacts', 'change_requests', 'recommended_transition', 'confidence', 'quality_evidence_ids',
  ],
} satisfies ObjectJsonSchema

const DECISION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    run_id: { type: 'string' },
    decision: { type: 'string', enum: ['go', 'no-go'] },
    basis: { type: 'array', items: { type: 'string' } },
    evidence_reviewed: { type: 'array', items: { type: 'string' } },
    conditions: { type: 'array', items: { type: 'string' } },
    open_risks: { type: 'array', items: { type: 'string' } },
    required_follow_up: { type: 'array', items: { type: 'string' } },
  },
  required: ['run_id', 'decision', 'basis', 'evidence_reviewed', 'conditions', 'open_risks', 'required_follow_up'],
} satisfies ObjectJsonSchema

/** Validate defaults even when a caller invokes apply() without Loader normalization. */
function resolveConfig(config: Config): ResolvedConfig {
  if (Object.hasOwn(config, 'maxReworkCycles')) {
    throw new TypeError('maxReworkCycles is unsupported; configure maxReworkPerGate instead')
  }
  const subagentProvider = config.subagentProvider ?? 'spawn'
  const maxReworkPerGate = config.maxReworkPerGate ?? 2
  const maxOwnerReassessmentsPerGate = config.maxOwnerReassessmentsPerGate ?? 2
  const maxRalphRounds = config.maxRalphRounds ?? 0
  const maxRalphHandoffChars = config.maxRalphHandoffChars ?? 16_384
  const qualityCommands = resolveQualityCatalog(config.qualityCommands ?? [])
  const limits: MaterialLimits = {
    maxMaterialFiles: config.maxMaterialFiles ?? 16,
    maxMaterialBytes: config.maxMaterialBytes ?? 65_536,
    maxMaterialTotalBytes: config.maxMaterialTotalBytes ?? 262_144,
  }
  for (const [field, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`)
  }
  if (subagentProvider.length === 0 || subagentProvider !== subagentProvider.trim()) {
    throw new TypeError('subagentProvider must be a non-empty normalized string')
  }
  if (!Number.isSafeInteger(maxReworkPerGate) || maxReworkPerGate < 1) {
    throw new TypeError('maxReworkPerGate must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxOwnerReassessmentsPerGate) || maxOwnerReassessmentsPerGate < 1) {
    throw new TypeError('maxOwnerReassessmentsPerGate must be a positive safe integer')
  }
  if (!Number.isSafeInteger(maxRalphRounds) || maxRalphRounds < 0) {
    throw new TypeError('maxRalphRounds must be a non-negative safe integer')
  }
  if (!Number.isSafeInteger(maxRalphHandoffChars) || maxRalphHandoffChars < 1) {
    throw new TypeError('maxRalphHandoffChars must be a positive safe integer')
  }
  return { subagentProvider, maxReworkPerGate, maxOwnerReassessmentsPerGate,
    maxRalphRounds, maxRalphHandoffChars, qualityCommands, ...limits }
}

/** Require a genuinely fresh structured-output provider for specialists. */
function requireFreshProvider(ctx: Context, name: string): SubagentProvider {
  const provider = ctx.subagents.getProvider(name)
  if (provider === undefined) {
    throw new Error(`Conductor subagent provider "${name}" is not registered`)
  }
  if (!provider.capabilities.outputSchema) {
    throw new Error(`Conductor subagent provider "${name}" does not support structured output`)
  }
  if (!provider.capabilities.toolFilter) {
    throw new Error(`Conductor subagent provider "${name}" does not support tool restrictions`)
  }
  if (!provider.capabilities.toolGuard) {
    throw new Error(`Conductor subagent provider "${name}" does not support argument-aware tool guards`)
  }
  if (!provider.capabilities.persona) {
    throw new Error(`Conductor subagent provider "${name}" does not support child personas`)
  }
  if (!provider.capabilities.toolContribution) {
    throw new Error(`Conductor subagent provider "${name}" does not support child tool contributions`)
  }
  if (provider.inheritsParentContext) {
    throw new Error(`Conductor subagent provider "${name}" inherits parent context; Conductor requires a fresh provider`)
  }
  return provider
}

/** Resolve attribution without accepting model-supplied execution authority. */
function resolveAuthority(value: ConductorCallArgs['authority']): ConductorAuthority {
  const owner = value?.owner
  if (typeof owner !== 'string' || owner.length === 0 || owner !== owner.trim()) {
    throw new Error('Conductor authority requires a non-empty normalized owner')
  }
  return { owner }
}

function rejectModelCloseoutAuthorization(value: object): void {
  if (Object.hasOwn(value, 'closeoutAuthorization')) {
    throw new Error('Conductor closeout authorization is host-only and is not accepted by the model-facing tool')
  }
}

function resolvePathList(value: string[] | undefined, field: string): string[] {
  const paths = value ?? []
  if (paths.some(path => path.length === 0 || path !== path.trim())) {
    throw new Error(`Conductor ${field} must contain only non-empty normalized paths`)
  }
  if (new Set(paths).size !== paths.length) throw new Error(`Conductor ${field} must not contain duplicates`)
  return [...paths]
}

function resolveStringList(value: string[] | undefined, field: string): string[] {
  const items = value ?? []
  if (items.some(item => item.length === 0 || item !== item.trim())) {
    throw new Error(`Conductor ${field} must contain only non-empty normalized strings`)
  }
  if (new Set(items).size !== items.length) throw new Error(`Conductor ${field} must not contain duplicates`)
  return [...items]
}

/** Compose the specialist child prompt from the role skill body, the dispatch package, and an optional Ralph directive. */
function composeSpecialistPrompt(
  stage: ConductorStage,
  run: ConductorRun,
  catalog: ReadonlyMap<string, QualityCommandDefinition>,
  qualityExecutions: readonly QualityExecutionRecord[],
  ralphResult?: unknown,
): string {
  const stageActions = [
    'read',
    ...((stage === 'headsman' || stage === 'integrator')
      && run.executionAuthorization?.effectProfile.filesystem === 'workspace-write' ? ['write'] : []),
  ]
  const parts = [
    'You are one specialist in a Conductor run. Work only on the dispatched stage, against the dispatch package below, and return exactly one structured result to the Conductor. You are a worker, not the workflow owner: never name the next specialist and never make a gate decision.',
    'Dispatch package:\n' + JSON.stringify({
      run_id: run.runId,
      stage,
      admission: run.admission,
      owner_ledger: run.ownerLedger,
      owner_revision: run.ownerRevision,
      effective_owner_mandate: effectiveOwnerMandate(run),
      admitted_route: admittedRoute(run.admission),
      analysis_reports: run.analysisReports,
      current_report: run.reportCandidates.at(-1) ?? null,
      current_audit_hash: currentAuditHash(run) ?? null,
      objective: run.objective,
      scope: run.scope,
      previous_specialist_reports: run.specialistReports,
      source_baseline: run.sourceBaseline,
      execution_baseline: run.baseline,
      allowed_paths: effectiveOwnerMandate(run).allowedPaths,
      excluded_paths: effectiveOwnerMandate(run).excludedPaths,
      allowed_actions: stageActions,
      prohibited_actions: [
        ...(stageActions.includes('write') ? [] : ['write']),
        ...EXTERNAL_ACTIONS,
        'shell',
      ],
      acceptance_criteria: run.acceptanceCriteria,
      ...run.admission.purpose === 'analysis' ? {
        report_criteria_instruction: ANALYSIS_CRITERIA_INSTRUCTION,
        gate_history: run.history,
      } : {},
      constraints: run.constraints,
      input_artifacts: run.inputArtifacts,
      questions_to_resolve: [],
      required_evidence: [],
      quality_command_catalog: (run.admission.purpose === 'analysis' ? [] : [...catalog.values()]).map(command => ({
        id: command.id,
        description: command.modelSafeDescription,
        allowed_stages: command.allowedStages,
      })),
      quality_execution_evidence: qualityExecutions.map(record => ({
        evidence_id: record.evidenceId,
        command_id: record.commandId,
        executor_stage: record.executorStage,
        outcome: record.outcome,
      })),
    }, null, 2),
    'Return the structured result in exactly the fields the schema requires.',
  ]
  if (ralphResult !== undefined) {
    parts.splice(parts.length - 1, 0,
      `Headsman-internal Ralph result (not a gate decision):\n${JSON.stringify(ralphResult, null, 2)}`)
  }
  return parts.join('\n\n')
}

/** Compose the Arbiter child prompt from the complete delivery record and gate history. */
function composeArbiterPrompt(run: ConductorRun): string {
  if (run.admission.purpose === 'analysis') {
    return [
      'You are The Arbiter reviewing a read-only analysis. Return accept, revise or blocked for the exact report and independent audit. Never grant GO, request approval or authorize execution.',
      'Analysis record:\n' + JSON.stringify({ run_id: run.runId, admission: run.admission,
        report: run.reportCandidates.at(-1), audit_hash: currentAuditHash(run), analysis_reports: run.analysisReports,
        history: run.history, acceptance_criteria: run.acceptanceCriteria,
        owner_ledger: run.ownerLedger, owner_revision: run.ownerRevision }, null, 2),
    ].join('\n\n')
  }
  return [
    'You are The Arbiter in a Conductor run. Review the full gate history and delivery package, then return a GO/NO-GO decision. A GO never grants commit, push, merge, or deploy authority by itself.',
    'Run, specialist reports, and gate history:\n' + JSON.stringify({
      run_id: run.runId,
      source_baseline: run.sourceBaseline,
      execution_baseline: run.baseline,
      specialist_reports: run.specialistReports,
      owner_ledger: run.ownerLedger,
      owner_revision: run.ownerRevision,
      history: run.history,
    }, null, 2),
    'Acceptance criteria:\n' + JSON.stringify(run.acceptanceCriteria, null, 2),
    'Return the DecisionRecord in exactly the fields the schema requires.',
  ].join('\n\n')
}

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

/** Load one required scoped skill or fail the dispatch before a child starts. */
async function requireSkill(ctx: Context, parent: Agent, signal: AbortSignal, name: string): Promise<string> {
  const skill = await ctx.skills.get(name, {
    scope: parent,
    cwd: parent.session.header.cwd,
    signal,
  })
  if (skill === undefined) throw new Error(`Conductor required skill "${name}" is unavailable`)
  return skill.content
}

/** Run one fresh structured child through the existing workflow engine. */
async function runWorkflowChild(
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
): Promise<unknown> {
  const workflow: WorkflowRun = ctx.workflowEngine.start({
    script: SPECIALIST_WORKFLOW_SCRIPT,
    meta: SPECIALIST_WORKFLOW_META,
    args: { prompt, label: `conductor-${stage}`, schema },
    subagentProvider: providerName,
    maxTotalAgents: 1,
    parent,
    signal,
    childToolFilter: run.admission.purpose === 'analysis' ? { allow: [...READ_TOOLS] } : toolRestrictionForStage(stage, run.executionAuthorization),
    childToolGuard: run.admission.purpose === 'analysis' ? analysisToolGuard : toolGuardForStage(stage, run.baseline, run.executionAuthorization),
    childPersona: persona,
    ...childToolContribution === undefined ? {} : { childToolContribution },
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

/** Reject removed or changed command definitions before every resumed dispatch. */
function assertCatalogBindings(
  run: ConductorRun,
  catalog: ReadonlyMap<string, QualityCommandDefinition>,
): void {
  for (const binding of run.baseline?.qualityCommands ?? []) {
    const current = catalog.get(binding.id)
    if (current === undefined) throw new Error(`Gate C quality command "${binding.id}" is no longer configured`)
    if (current.definitionHash !== binding.definitionHash) {
      throw new Error(`Gate C quality command "${binding.id}" definition changed; resume is refused`)
    }
    const requiredGates = current.allowedStages.map(value => value === 'headsman' ? 'D' : 'E')
    if (requiredGates.length !== binding.requiredGates.length
      || requiredGates.some((gate, index) => binding.requiredGates[index] !== gate)) {
      throw new Error(`Gate C quality command "${binding.id}" gate applicability changed; resume is refused`)
    }
  }
}

interface ResolvedSpecialistEnvelope {
  readonly envelope: SpecialistEnvelope
  readonly boundaryProblem?: SpecialistProblem
}

function unresolvedEnvelope(value: unknown, problem: string, kind: SpecialistProblem['kind'] = 'report'): ResolvedSpecialistEnvelope {
  return { envelope: value as SpecialistEnvelope, boundaryProblem: { kind, message: problem } }
}

/** Resolve model-selected Gate-C command ids to host-owned immutable bindings. */
function resolveSpecialistEnvelope(
  value: unknown,
  stage: ConductorStage,
  run: ConductorRun,
  catalog: ReadonlyMap<string, QualityCommandDefinition>,
): ResolvedSpecialistEnvelope {
  if (!isRecord(value)) return { envelope: value as SpecialistEnvelope }
  if (stage !== 'devils-advocate' || value['status'] !== 'ready') {
    return { envelope: value as unknown as SpecialistEnvelope }
  }
  const proposal = value['execution_baseline']
  if (isRecord(proposal) && (Object.hasOwn(proposal, 'allowedPaths') || Object.hasOwn(proposal, 'excludedPaths'))) {
    return unresolvedEnvelope(value, 'Gate C paths are runtime-owned; omit allowedPaths and excludedPaths from execution_baseline')
  }
  if (isRecord(proposal) && Object.hasOwn(proposal, 'qualityCommands')) {
    return unresolvedEnvelope(value, 'Gate C quality bindings are host-only; supply qualityCommandIds', 'authority')
  }
  if (!isRecord(proposal) || !Array.isArray(proposal['qualityCommandIds'])) {
    return unresolvedEnvelope(value, 'Gate C requires execution_baseline with qualityCommandIds')
  }
  const ids = proposal['qualityCommandIds'] as unknown[]
  if (ids.some(id => typeof id !== 'string' || id.length === 0 || id !== id.trim())) {
    return unresolvedEnvelope(value, 'Gate C qualityCommandIds must contain normalized strings')
  }
  if (new Set(ids).size !== ids.length) {
    return unresolvedEnvelope(value, 'Gate C qualityCommandIds must not contain duplicates')
  }
  const normalizedIds = ids as string[]
  if (normalizedIds.some(id => !ownerCommandAllowed(run, id))) {
    return unresolvedEnvelope(value, 'Gate C command selection exceeds the effective owner mandate', 'authority')
  }
  const qualityCommands: QualityCommandBinding[] = []
  for (const id of normalizedIds) {
    const definition = catalog.get(id)
    if (definition === undefined) {
      return unresolvedEnvelope(value, `Gate C selected unknown quality command "${id}"`)
    }
    qualityCommands.push({
      id: QualityCommandId(id),
      definitionHash: definition.definitionHash,
      requiredGates: definition.allowedStages.map(value => value === 'headsman' ? 'D' : 'E'),
    })
  }
  return {
    envelope: {
      ...(value as unknown as Omit<SpecialistEnvelope, 'execution_baseline'>),
      execution_baseline: {
        scopeVersion: proposal['scopeVersion'] as string,
        planVersion: proposal['planVersion'] as string,
        acceptanceVersion: proposal['acceptanceVersion'] as string,
        allowedPaths: effectiveOwnerMandate(run).allowedPaths,
        excludedPaths: effectiveOwnerMandate(run).excludedPaths,
        rollbackReference: proposal['rollbackReference'] as string,
        qualityCommands,
      },
    },
  }
}

/** Read one specialist's structured envelope across the subagent boundary. */
async function runSpecialist(
  ctx: Context,
  providerName: string,
  parent: Agent,
  signal: AbortSignal,
  stage: ConductorStage,
  run: ConductorRun,
  maxRalphHandoffChars: number,
  catalog: ReadonlyMap<string, QualityCommandDefinition>,
): Promise<SpecialistDispatchResult | AnalysisEnvelope> {
  const roleName = ROLE_SKILL[stage]
  /* v8 ignore next -- runSpecialist receives only stages covered by the complete ROLE_SKILL mapping. */
  if (roleName === undefined) throw new Error(`Conductor stage "${stage}" has no role skill`)
  const [roleBody, specialistBody] = await Promise.all([
    requireSkill(ctx, parent, signal, roleName),
    requireSkill(ctx, parent, signal, 'conductor-specialist'),
  ])
  let ralphBody: string | undefined
  if (stage === 'headsman') {
    const ralphSkill = run.budget.maxRalphRounds > 0
      ? await requireSkill(ctx, parent, signal, 'conductor-ralph')
      : undefined
    ralphBody = ralphDirective(run.budget.maxRalphRounds, ralphSkill)
  }
  const persona = [roleBody, specialistBody, ralphBody].filter(value => value !== undefined).join('\n\n')
  if (run.admission.purpose === 'analysis') {
    return await runWorkflowChild(ctx, providerName, parent, signal, stage, run,
      composeSpecialistPrompt(stage, run, new Map(), []), ANALYSIS_SCHEMA, persona) as AnalysisEnvelope
  }
  assertCatalogBindings(run, catalog)
  const qualityExecutions: QualityExecutionRecord[] = []
  const policyStage: QualityPolicyStage | undefined = stage === 'headsman' || stage === 'auditor' ? stage : undefined
  const requiredQualityCommands = policyStage === undefined || run.baseline === null
    ? []
    : run.baseline.qualityCommands.filter(binding => binding.requiredGates.includes(policyStage === 'headsman' ? 'D' : 'E'))
  const gate = stage === 'headsman' ? 'D' : stage === 'auditor' ? 'E' : undefined
  const cycle = gate === undefined ? undefined : nextQualityCycle(run, gate)
  const headsmanContribution = stage === 'headsman' && gate !== undefined && cycle !== undefined
    && requiredQualityCommands.length > 0
    ? qualityToolContribution({
      run,
      policyStage: 'headsman',
      executorStage: 'headsman',
      gate,
      cycle,
      catalog,
      requiredBindings: requiredQualityCommands,
      records: qualityExecutions,
      sandbox: ctx.sandbox,
      subprocess: ctx.subprocess,
    })
    : undefined
  const auditorContribution = stage === 'auditor' && gate !== undefined && cycle !== undefined
    && requiredQualityCommands.length > 0
    ? qualityToolContribution({
      run,
      policyStage: 'auditor',
      executorStage: 'auditor',
      gate,
      cycle,
      catalog,
      requiredBindings: requiredQualityCommands,
      records: qualityExecutions,
      sandbox: ctx.sandbox,
      subprocess: ctx.subprocess,
    })
    : undefined
  const ralphContribution = stage === 'headsman' && gate !== undefined && cycle !== undefined
    && requiredQualityCommands.length > 0
    ? qualityToolContribution({
      run,
      policyStage: 'headsman',
      executorStage: 'ralph',
      gate,
      cycle,
      catalog,
      requiredBindings: requiredQualityCommands,
      records: qualityExecutions,
      sandbox: ctx.sandbox,
      subprocess: ctx.subprocess,
    })
    : undefined
  const ralphObjective = [
    `Implement the approved Conductor baseline for: ${run.objective}`,
    'Approved Conductor dispatch:\n' + JSON.stringify({
      run_id: run.runId,
      source_baseline: run.sourceBaseline,
      execution_baseline: run.baseline,
      acceptance_criteria: run.acceptanceCriteria,
      constraints: run.constraints,
    }, null, 2),
    'Approved Gate C quality commands available through conductor_quality_check:\n'
      + JSON.stringify(requiredQualityCommands.map(binding => ({
        id: binding.id,
        description: catalog.get(binding.id)?.modelSafeDescription,
      })), null, 2),
    'Run every listed command and retain its host evidence for the Headsman report.',
  ].join('\n\n')
  try {
    const ralphOutcome = stage === 'headsman' && run.budget.maxRalphRounds > 0
      ? await runRalphWorkflow(ctx, {
        observeRun: workflow => observeConductorChildren(ctx, parent.session, workflow, run, 'ralph'),
        objective: ralphObjective,
        maxRounds: run.budget.maxRalphRounds,
        maxHandoffChars: maxRalphHandoffChars,
        maxResultChars: maxRalphHandoffChars,
        subagentProvider: providerName,
        parent,
        signal,
        childToolFilter: toolRestrictionForStage(stage, run.executionAuthorization),
        childToolGuard: toolGuardForStage(stage, run.baseline, run.executionAuthorization),
        childPersona: persona,
        ...ralphContribution === undefined ? {} : { childToolContribution: ralphContribution },
      })
      : undefined
    const structured = await runWorkflowChild(
      ctx, providerName, parent, signal, stage, run,
      composeSpecialistPrompt(stage, run, catalog, qualityExecutions, ralphOutcome?.result), ENVELOPE_SCHEMA, persona,
      headsmanContribution ?? auditorContribution,
    )
    const resolved = resolveSpecialistEnvelope(structured, stage, run, catalog)
    return { ...resolved, qualityExecutions, requiredQualityCommands }
  } catch (error) {
    if (qualityExecutions.length === 0) throw error
    throw new SpecialistExecutionFailure(
      error, stage, error instanceof SpecialistExecutionFailure && error.childStarted, qualityExecutions,
    )
  }
}

/** Read the Arbiter's decision across the subagent boundary. */
async function runArbiter(
  ctx: Context,
  providerName: string,
  parent: Agent,
  signal: AbortSignal,
  run: ConductorRun,
): Promise<DecisionRecord | ReportDecision> {
  const arbiterRole = ROLE_SKILL['arbiter']
  /* v8 ignore next -- the preset's typed ROLE_SKILL constant always declares the Arbiter role. */
  if (arbiterRole === undefined) throw new Error('Conductor Arbiter role skill mapping is unavailable')
  const [roleBody, closeoutBody] = await Promise.all([
    requireSkill(ctx, parent, signal, arbiterRole),
    requireSkill(ctx, parent, signal, run.admission.purpose === 'analysis' ? 'conductor-specialist' : 'conductor-closeout'),
  ])
  const structured = await runWorkflowChild(
    ctx, providerName, parent, signal, 'arbiter', run,
    composeArbiterPrompt(run), run.admission.purpose === 'analysis' ? REPORT_DECISION_SCHEMA : DECISION_SCHEMA, `${roleBody}\n\n${closeoutBody}`,
  )
  return structured as DecisionRecord | ReportDecision
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/** Ask the host for one exact Gate-C execution authorization. */
async function requestExecutionAuthorization(
  ctx: Context,
  parent: Agent,
  signal: AbortSignal,
  callId: CallId,
  run: ConductorRun,
  baseline: ExecutionBaseline,
  effectProfile: ExecutionEffectProfile,
  catalog: ReadonlyMap<string, QualityCommandDefinition>,
): Promise<ExecutionAuthorization | null> {
  const approval = ctx.get('approval')
  if (approval === undefined) {
    throw new Error('Gate C execution approval is unavailable; no host approval service is mounted')
  }
  const cwd = parent.session.header.cwd
  if (cwd === undefined) throw new Error('Gate C execution approval requires a session workspace')
  const workspace = canonicalAbsolute(cwd, cwd)
  const qualityCommands = baseline.qualityCommands.map((binding) => {
    const definition = catalog.get(binding.id) as QualityCommandDefinition
    return {
      id: binding.id,
      definition_hash: binding.definitionHash,
      description: definition.modelSafeDescription,
    }
  })
  const executionBaselineHashValue = executionBaselineHash(baseline)
  const reason = 'Approve this exact Gate C execution baseline once. Rejection, cancellation, or unavailable approval '
    + 'prevents every write-capable specialist and quality-command spawn.\n'
    + JSON.stringify({
      run_id: run.runId,
      mandate_owner: run.authority.owner,
      execution_baseline_hash: executionBaselineHashValue,
      effect_profile: effectProfile,
      allowed_paths: baseline.allowedPaths.map(path => canonicalAbsolute(workspace, path)),
      excluded_paths: baseline.excludedPaths.map(path => canonicalAbsolute(workspace, path)),
      quality_commands: qualityCommands,
    }, null, 2)
  const outcome = await approval.request({ agent: parent, toolName: 'conductor', callId, reason, signal })
  switch (outcome) {
    case 'allowed-once':
      return { executionBaselineHash: executionBaselineHashValue, effectProfile: { ...effectProfile } }
    case 'rejected':
    case 'cancelled':
      return null
    case 'unavailable':
      throw new Error('Gate C execution approval is unavailable')
  }
}

/** Render the terminal outcome without presenting self-report as certification. */
function renderOutcome(value: unknown): string {
  const status = isRecord(value) && isRecord(value['run'])
    ? `\nRun status:\n${JSON.stringify(value['run'], null, 2)}`
    : ''
  if (isRecord(value) && value['kind'] === 'decision') {
    return `Conductor reached the Arbiter.\nDecision:\n${JSON.stringify(value['decision'], null, 2)}${status}`
  }
  if (isRecord(value) && value['kind'] === 'report') {
    return `Conductor analysis reported.\nReport:\n${JSON.stringify(value['report'], null, 2)}\nReport decision:\n${JSON.stringify(value['decision'], null, 2)}${status}`
  }
  if (isRecord(value) && value['kind'] === 'blocked') {
    return `Conductor run blocked: ${String(value['blocker'])}${status}`
  }
  if (isRecord(value) && value['kind'] === 'closeout') {
    return `Conductor run closed.\nCloseout:\n${JSON.stringify(value['closeout'], null, 2)}`
  }
  return 'Conductor run returned an unknown outcome'
}

/** Report gate attempts and a child that failed before its gate could be recorded. */
function runSummary(run: ConductorRun, failedStage?: ConductorStage) {
  return {
    runId: run.runId,
    stage: run.currentStage,
    status: run.status,
    gateHistory: run.history,
    specialistsRan: [...new Set([
      ...run.history.filter(record => record.kind === 'evaluated' && record.origin !== 'intake-validation').map(record => record.stage),
      ...failedStage === undefined ? [] : [failedStage],
    ])],
  }
}

function presentCall(args: ConductorCallArgs): ToolCallView {
  return { card: 'generic', title: 'conductor', rawInput: args.objective }
}

function presentResult(_args: ConductorCallArgs, _result: { content: ContentBlock[]; isError: boolean }): ToolResultView {
  return { card: 'generic' }
}

/** Register the Conductor tool and its gated specialist driver. */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(conductorChildrenProjection)
  })
  const resolved = resolveConfig(config)
  requireFreshProvider(ctx, resolved.subagentProvider)
  const ownerController = new ConductorOwnerController(ctx)
  if (config.routeTasks === true) installModeRouting(ctx, ownerController)

  ctx.tools.register(defineTool({
    name: 'conductor',
    description: DESCRIPTION,
    parameters: {
      purpose: { type: 'string', enum: ['implementation', 'analysis'], required: true, description: 'Implementation or read-only analysis; verification is not supported.' },
      entry: { type: 'string', enum: ['detective', 'strategist', 'devils-advocate'], required: true, description: 'Entry justified by the supplied work; never grants execution authority.' },
      deliverable: { type: 'string', enum: ['answer', 'recommendations'], description: 'Required for analysis and forbidden for implementation.' },
      rationale: { type: 'string', description: 'Required intake rationale for a new run.' },
      materialFiles: { type: 'array', items: { type: 'string' }, description: 'Workspace-relative text files explicitly cited in the current user message.' },
      scopeSources: { type: 'array', items: { type: 'string' }, description: 'Supplied scope sources: current-request or cited material file paths.' },
      plan: { type: 'array', items: { type: 'string' }, description: 'Supplied plan steps, when present in the owner material; do not invent them.' },
      planSources: { type: 'array', items: { type: 'string' }, description: 'Supplied plan sources: current-request or cited material file paths.' },
      objective: {
        type: 'string',
        required: true,
        description: 'The desired outcome for the Conductor run.',
      },
      constraints: {
        type: 'array',
        items: { type: 'string' },
        description: 'Non-negotiable limits or restrictions on the work. Put measurable deliverable requirements in acceptanceCriteria, not here.',
      },
      scope: {
        type: 'array',
        items: { type: 'string' },
        description: 'Files, components, or concerns included in the run.',
      },
      inputArtifacts: {
        type: 'array',
        items: { type: 'string' },
        description: 'Artifact paths or identifiers available to every specialist.',
      },
      allowedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Owner-authorized roots that write-capable stages may modify; omission authorizes no writes.',
      },
      excludedPaths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Owner-declared roots excluded from every specialist write.',
      },
      sourceBaseline: {
        type: 'string',
        description: 'Optional source version or commit observed at intake; Detective establishes it when omitted.',
      },
      acceptanceCriteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Measurable deliverable requirements, required and non-empty for a new analysis. Report criteria must copy these strings verbatim in the same order. Constraints are restrictions, not acceptance criteria.',
      },
      authority: {
        type: 'object',
        additionalProperties: false,
        properties: {
          owner: { type: 'string', required: true },
        },
        description: 'Mandate-owner attribution only. Execution effects require a separate host-owned Gate C approval.',
      },
      runId: {
        type: 'string',
        description: 'Optional run id to resume an existing unfinished run.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          runId: { type: 'string', required: true },
          stage: { type: 'string', required: true },
          status: { type: 'string', required: true },
          result: { type: 'json', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderOutcome(value.result) }],
    },
    async execute(args, exec) {
      let activeRun: ConductorRun | undefined
      try {
        const parent = exec.agent
        if (parent === undefined) {
          throw new Error('Conductor tool requires a calling agent (exec.agent was undefined)')
        }
        rejectModelCloseoutAuthorization(args)
        const call: ConductorCallArgs = args
        const objective = call.objective.trim()
        if (objective.length === 0) throw new Error('Conductor objective must be a non-empty string')
        const authority = resolveAuthority(call.authority)
        const allowedPaths = resolvePathList(call.allowedPaths, 'allowedPaths')
        const excludedPaths = resolvePathList(call.excludedPaths, 'excludedPaths')
        const store = new SessionConductorRunStore(parent.session, async () => {
          const flushed = await ctx.sessions.flush(parent.session)
          if (!flushed) throw new Error(`Conductor could not durably flush session ${parent.session.id}`)
        })

        let run: ConductorRun
        const ownerContinuation = await ownerController.consume(parent, call.runId, exec.signal)
        if (ownerContinuation !== undefined) {
          run = ownerContinuation
        } else if (call.runId !== undefined) {
          if (!isValidRunId(call.runId)) throw new Error(`Conductor runId "${call.runId}" is not a valid CON-YYYY-NNNN id`)
          run = await resumeRun(store, ConductorRunId(call.runId))
          if (call.purpose !== run.admission.purpose || call.entry !== run.admission.entry
            || call.deliverable !== (run.admission.purpose === 'analysis' ? run.admission.deliverable : undefined)) {
            throw new Error('Conductor resume purpose, entry and deliverable must match the immutable admission')
          }
          if (call.materialFiles !== undefined || call.scopeSources !== undefined || call.plan !== undefined
            || call.planSources !== undefined || call.rationale !== undefined) throw new Error('Conductor resume reuses captured admission; new material requires a new run')
          if (run.objective !== objective) throw new Error('Conductor resume objective does not match the persisted run')
          if (run.authority.owner !== authority.owner) {
            throw new Error('Conductor resume authority does not match the persisted run')
          }
          if (!sameOrderedStrings(run.allowedPaths, allowedPaths)) {
            throw new Error('Conductor resume allowedPaths do not match the persisted run')
          }
          if (!sameOrderedStrings(run.excludedPaths, excludedPaths)) {
            throw new Error('Conductor resume excludedPaths do not match the persisted run')
          }
        } else {
          const materials = await captureMaterials(ctx, parent, resolveStringList(call.materialFiles, 'materialFiles'), resolved, exec.signal)
          const admission = admitIntake({ purpose: call.purpose, entry: call.entry,
            ...call.deliverable === undefined ? {} : { deliverable: call.deliverable }, rationale: call.rationale,
            ...call.scopeSources === undefined ? {} : { scopeSources: call.scopeSources },
            ...call.plan === undefined ? {} : { plan: call.plan },
            ...call.planSources === undefined ? {} : { planSources: call.planSources },
          }, materials)
          if (Buffer.byteLength(JSON.stringify(admission)) > resolved.maxMaterialTotalBytes) throw new Error('Conductor admission exceeds maxMaterialTotalBytes')
          let runId = mintRunId()
          for (let attempt = 0; attempt < 8 && (await store.load(runId)) !== undefined; attempt += 1) {
            runId = mintRunId()
          }
          run = createRun(runId, {
            admission,
            objective,
            scope: resolveStringList(call.scope, 'scope'),
            inputArtifacts: resolveStringList(call.inputArtifacts, 'inputArtifacts'),
            allowedPaths,
            excludedPaths,
            ...call.sourceBaseline !== undefined ? { sourceBaseline: call.sourceBaseline } : {},
            authority,
            ownerSessionId: parent.session.id,
            ownerCapabilities: { allowedPaths: ['.'], excludedPaths,
              qualityCommandIds: [...resolved.qualityCommands.keys()] },
            constraints: resolveStringList(call.constraints, 'constraints'),
            acceptanceCriteria: resolveStringList(call.acceptanceCriteria, 'acceptanceCriteria'),
            budget: { maxReworkPerGate: resolved.maxReworkPerGate,
              maxOwnerReassessmentsPerGate: resolved.maxOwnerReassessmentsPerGate, maxRalphRounds: resolved.maxRalphRounds },
          })
          await store.save(run)
        }
        activeRun = run

        if (run.currentStage === 'closeout') {
          return {
            runId: run.runId,
            stage: run.currentStage,
            status: run.status,
            result: {
              kind: 'blocked',
              blocker: 'Arbiter GO recorded; closeout requires separate host-side authorization through closeRun',
              run: runSummary(run),
            } as unknown as JsonValue,
          }
        }
        assertCatalogBindings(run, resolved.qualityCommands)

        let lastObservation: OwnerDispatchObservation | undefined
        const observeReport = (current: ConductorRun, report: unknown): void => {
          const child = parent.session.events.findLast(event => event.type === 'conductor/child'
            && event.data.runId === current.runId && event.data.role === current.currentStage
            && event.data.historyOffset === current.history.length)
          lastObservation = child?.type === 'conductor/child' ? { historyOffset: current.history.length,
            childId: child.data.childId, attempt: child.data.attempt,
            report: JSON.parse(JSON.stringify(report ?? null)) as unknown } : undefined
        }
        const dispatcher = {
          async authorizeExecution(
            current: ConductorRun,
            baseline: ExecutionBaseline,
            effectProfile: ExecutionEffectProfile,
          ) {
            return await requestExecutionAuthorization(
              ctx,
              parent,
              exec.signal,
              exec.callId,
              current,
              baseline,
              effectProfile,
              resolved.qualityCommands,
            )
          },
          async dispatchSpecialist(stage: ConductorStage, current: ConductorRun) {
            const result = await runSpecialist(
              ctx, resolved.subagentProvider, parent, exec.signal, stage, current, resolved.maxRalphHandoffChars,
              resolved.qualityCommands,
            )
            observeReport(current, 'envelope' in result ? result.envelope : result)
            return result
          },
          async dispatchArbiter(current: ConductorRun) {
            const result = await runArbiter(ctx, resolved.subagentProvider, parent, exec.signal, current)
            observeReport(current, result)
            return result
          },
        }

        const saveCheckpoint = async (checkpoint: ConductorRun): Promise<void> => {
          await store.save(checkpoint)
          publishChildGates(parent.session, checkpoint)
          activeRun = checkpoint
        }
        const driven = await drive(run, dispatcher, saveCheckpoint)
        const { outcome } = await settleOwnerEscalation(ctx, driven, lastObservation,
          parent.session.header.cwd ?? process.cwd(), saveCheckpoint, true)

        if (outcome.run.status === 'awaiting_owner') ownerController.offer(parent, outcome.run.runId)

        return {
          runId: outcome.run.runId,
          stage: outcome.run.currentStage,
          status: outcome.run.status,
          result: (outcome.kind === 'report' ? { kind: 'report', report: outcome.report, decision: outcome.decision, run: runSummary(outcome.run) } : outcome.kind === 'decision'
            ? { kind: 'decision', decision: outcome.decision, run: runSummary(outcome.run) }
            : { kind: 'blocked', blocker: outcome.blocker, run: runSummary(outcome.run) }) as unknown as JsonValue,
        }
      } catch (cause) {
        if (cause instanceof OwnerContinuationInterruption) activeRun = cause.run
        const message = cause instanceof Error ? cause.message : String(cause)
        const failedStage = cause instanceof SpecialistExecutionFailure && cause.childStarted ? cause.stage : undefined
        throw new Error(activeRun === undefined
          ? `No Conductor run was started: ${message}`
          : `Conductor run blocked: ${message}\nRun status:\n${JSON.stringify(runSummary(activeRun, failedStage), null, 2)}`, { cause })
      }
    },
    presentCall,
    presentResult,
  }))
}
