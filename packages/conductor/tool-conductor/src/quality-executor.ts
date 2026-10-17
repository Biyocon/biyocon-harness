/** Child-scoped Conductor quality-command executor. */

import { createHash, randomUUID } from 'node:crypto'
import {
  executionBaselineHash,
  executionEffectProfile,
  QualityEvidenceId,
} from '@deepseek-ai/dsh-conductor'
import type {
  ConductorRun,
  QualityCommandBinding,
  QualityExecutionFailure,
  QualityExecutionRecord,
  QualityExecutorStage,
  QualityPolicyStage,
} from '@deepseek-ai/dsh-conductor'
import {
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSandboxSignature,
} from '@deepseek-ai/dsh-sandbox'
import type { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { SubagentChildToolContribution } from '@deepseek-ai/dsh-subagent'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { deadline, timeoutOf } from '@deepseek-ai/dsh-timeout'
import type { QualityCommandDefinition } from './quality-catalog.ts'
import { canonicalAbsolute, containsPath } from './path-policy.ts'

const TIMEOUT_CODE = 'CONDUCTOR_QUALITY_TIMEOUT'

/** Inputs fixed by Conductor for one child dispatch. */
export interface QualityToolScope {
  /** Current Conductor run snapshot. */
  run: ConductorRun
  /** Capability-policy stage applied to the child. */
  policyStage: QualityPolicyStage
  /** Exact executor identity recorded as evidence. */
  executorStage: QualityExecutorStage
  /** Gate for which this dispatch produces evidence. */
  gate: 'D' | 'E'
  /** One-based attempt number for this gate. */
  cycle: number
  /** Validated deployment catalog captured by the host. */
  catalog: ReadonlyMap<string, QualityCommandDefinition>
  /** Baseline bindings required in this dispatch. */
  requiredBindings: readonly QualityCommandBinding[]
  /** Host-owned record sink for this dispatch. */
  records: QualityExecutionRecord[]
  /** Parent-injected confinement service, never resolved from the child. */
  sandbox: SandboxProvider
  /** Parent-injected process service, never resolved from the child. */
  subprocess: SubprocessRuntime
}

interface QualityToolResult {
  evidenceId: string
  outcome: 'passed' | 'failed'
  failure?: QualityExecutionFailure
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function resultText(result: QualityToolResult): string {
  return JSON.stringify(result)
}

function boundedError(error: unknown, maxBytes: number): { text: string; truncated: boolean } {
  const text = String(error)
  const bytes = Buffer.from(text)
  if (bytes.length <= maxBytes) return { text, truncated: false }
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let end = maxBytes
  while (end > 0) {
    try {
      return { text: decoder.decode(bytes.subarray(0, end)), truncated: true }
    } catch {
      end -= 1
    }
  }
  return { text: '', truncated: true }
}

function classifySpawnFailure(
  signal: AbortSignal,
  error: unknown,
  runnerProgram: string | undefined,
  cwd: string,
): QualityExecutionFailure {
  if (signal.aborted) {
    return timeoutOf(signal, TIMEOUT_CODE) === undefined ? 'cancelled' : 'timeout'
  }
  return isRunnerSpawnFailure(error, runnerProgram, cwd) ? 'sandbox-unavailable' : 'runner-failure'
}

function failureResult(
  scope: QualityToolScope,
  definition: QualityCommandDefinition,
  childSessionId: QualityExecutionRecord['childSessionId'],
  startedAt: string,
  failure: QualityExecutionFailure,
  output: { stdout?: string; stderr?: string; stdoutTruncated?: boolean; stderrTruncated?: boolean } = {},
  process: { exitCode?: number | null; signal?: string | null } = {},
): QualityToolResult {
  const baseline = scope.run.baseline
  if (baseline === null) throw new Error('quality execution requires the Gate C baseline')
  const evidenceId = QualityEvidenceId(randomUUID())
  const stdout = output.stdout ?? ''
  const stderr = output.stderr ?? ''
  const record: QualityExecutionRecord = {
    evidenceId,
    runId: scope.run.runId,
    childSessionId,
    commandId: definition.id,
    definitionHash: definition.definitionHash,
    executionBaselineHash: executionBaselineHash(baseline),
    gate: scope.gate,
    cycle: scope.cycle,
    policyStage: scope.policyStage,
    executorStage: scope.executorStage,
    outcome: 'failed',
    failure,
    exitCode: process.exitCode ?? null,
    signal: process.signal ?? null,
    startedAt,
    finishedAt: new Date().toISOString(),
    stdoutSha256: digest(stdout),
    stderrSha256: digest(stderr),
    stdoutTruncated: output.stdoutTruncated ?? false,
    stderrTruncated: output.stderrTruncated ?? false,
  }
  scope.records.push(record)
  return {
    evidenceId,
    outcome: 'failed',
    failure,
    stdout,
    stderr,
    stdoutTruncated: record.stdoutTruncated,
    stderrTruncated: record.stderrTruncated,
  }
}

/**
 * Build the trusted installer for one stage-scoped quality tool.
 * @param scope - host-owned run, policy, service, and record state.
 * @returns a child-only installer for the private quality tool.
 */
export function qualityToolContribution(scope: QualityToolScope): SubagentChildToolContribution {
  return childCtx => childCtx.tools.register(defineTool({
    name: 'conductor_quality_check',
    description: 'Run one approved baseline quality command by command_id. Raw commands and arguments are not accepted.',
    parameters: {
      command_id: { type: 'string', required: true, description: 'Approved quality command id from the Gate C baseline.' },
    },
    async execute(args, exec) {
      if (Object.keys(args).length !== 1) {
        throw new Error('conductor_quality_check accepts only command_id')
      }
      const commandId = args.command_id
      if (typeof commandId !== 'string') throw new Error('conductor_quality_check requires command_id')
      const definition = scope.catalog.get(commandId)
      if (definition === undefined) throw new Error(`unknown Conductor quality command "${commandId}"`)
      const binding = scope.run.baseline?.qualityCommands.find(value => value.id === commandId)
      if (binding === undefined) throw new Error(`quality command "${commandId}" is not in the Gate C baseline`)
      if (binding.definitionHash !== definition.definitionHash) {
        throw new Error(`quality command "${commandId}" definition changed after Gate C`)
      }
      if (!scope.requiredBindings.some(value => value.id === binding.id && value.definitionHash === binding.definitionHash)) {
        throw new Error(`quality command "${commandId}" is not allowed for ${scope.policyStage}`)
      }
      if (scope.run.baseline === null) throw new Error('quality command requires the Gate C baseline')
      const baselineHash = executionBaselineHash(scope.run.baseline)
      const authorization = scope.run.executionAuthorization
      if (authorization === null || authorization.executionBaselineHash !== baselineHash) {
        throw new Error('quality command requires matching host authorization for the active Gate C baseline')
      }
      const requiredProfile = executionEffectProfile(scope.run.baseline)
      if (authorization.effectProfile.filesystem !== requiredProfile.filesystem
        || authorization.effectProfile.quality !== requiredProfile.quality) {
        throw new Error('quality command is outside the host-authorized effect profile')
      }
      if (definition.effectProfile.filesystem === 'workspace-write'
        && authorization.effectProfile.filesystem !== 'workspace-write') {
        throw new Error(`quality command "${commandId}" requires workspace-write authorization`)
      }
      const agent = exec.agent
      if (agent === undefined) throw new Error('quality command requires a child agent')
      const workspacePath = agent.session.header.cwd
      if (workspacePath === undefined) throw new Error('quality command requires a session workspace')
      const workspace = canonicalAbsolute(workspacePath, workspacePath)
      const cwd = canonicalAbsolute(workspace, definition.cwd)
      if (!containsPath(workspace, cwd)) throw new Error(`quality command "${commandId}" cwd escapes the workspace`)
      let workspaceRoot = workspace
      if (definition.effectProfile.filesystem === 'workspace-write') {
        if (definition.writeRoot === undefined) throw new Error(`quality command "${commandId}" lacks writeRoot`)
        const writeRoot = canonicalAbsolute(workspace, definition.writeRoot)
        const allowed = scope.run.baseline.allowedPaths
          .map(path => canonicalAbsolute(workspace, path))
          .some(path => containsPath(path, writeRoot))
        if (!allowed) throw new Error(`quality command "${commandId}" writeRoot is outside allowed_paths`)
        const overlapsExclusion = scope.run.baseline.excludedPaths
          .map(path => canonicalAbsolute(workspace, path))
          .some(path => containsPath(writeRoot, path) || containsPath(path, writeRoot))
        if (overlapsExclusion) throw new Error(`quality command "${commandId}" writeRoot overlaps excluded_paths`)
        workspaceRoot = writeRoot
      }

      const startedAt = new Date().toISOString()
      const childSessionId = agent.session.id
      let confined
      try {
        confined = scope.sandbox.confine(definition.argv, {
          mode: definition.effectProfile.filesystem,
          network: definition.effectProfile.network,
          workspaceRoot,
          sessionId: childSessionId,
        })
      } catch (error) {
        const detail = boundedError(error, definition.maxOutputBytes)
        return failureResult(scope, definition, childSessionId, startedAt, 'sandbox-unavailable', {
          stderr: detail.text,
          stderrTruncated: detail.truncated,
        })
      }
      if (confined.enforcement !== 'full') {
        return failureResult(scope, definition, childSessionId, startedAt, 'sandbox-unavailable', {
          stderr: 'sandbox backend provides partial enforcement; full enforcement is required',
        })
      }

      using commandDeadline = deadline(exec.signal, definition.timeoutMs, TIMEOUT_CODE)
      let handle
      try {
        handle = scope.subprocess.spawn({
          argv: confined.argv,
          cwd,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: definition.maxOutputBytes },
            stderr: { maxBytes: definition.maxOutputBytes },
          },
          graceMs: definition.graceMs,
          signal: commandDeadline.signal,
        })
      } catch (error) {
        const failure = classifySpawnFailure(commandDeadline.signal, error, confined.argv[0], cwd)
        const detail = boundedError(error, definition.maxOutputBytes)
        return failureResult(scope, definition, childSessionId, startedAt, failure, {
          stderr: detail.text,
          stderrTruncated: detail.truncated,
        })
      }

      let outcome
      try {
        outcome = await handle.done
      } catch (error) {
        await handle.waitForExit()
        const failure = classifySpawnFailure(commandDeadline.signal, error, confined.argv[0], cwd)
        const detail = boundedError(error, definition.maxOutputBytes)
        return failureResult(scope, definition, childSessionId, startedAt, failure, {
          stderr: detail.text,
          stderrTruncated: detail.truncated,
        })
      }
      await handle.waitForExit()
      const stdoutRead = handle.collected.stdout?.readFrom(0)
      const stderrRead = handle.collected.stderr?.readFrom(0)
      const stdout = stdoutRead?.text ?? ''
      const stderr = stderrRead?.text ?? ''
      const output = {
        stdout,
        stderr,
        stdoutTruncated: stdoutRead?.lossy ?? false,
        stderrTruncated: stderrRead?.lossy ?? false,
      }
      const runnerFailure = classifyRunnerFailure(outcome.exitCode, stderr, confined.runnerFailureRules)
      const failure: QualityExecutionFailure | undefined = commandDeadline.signal.aborted
        ? timeoutOf(commandDeadline.signal, TIMEOUT_CODE) === undefined ? 'cancelled' : 'timeout'
        : runnerFailure !== undefined ? 'runner-failure'
          : matchesSandboxSignature(outcome.exitCode, stderr, confined.denialSignatures) ? 'denied'
            : outcome.signal !== null ? 'signal'
              : outcome.exitCode !== 0 ? 'nonzero-exit'
                : undefined
      if (failure !== undefined) {
        return failureResult(scope, definition, childSessionId, startedAt, failure, output, outcome)
      }
      const evidenceId = QualityEvidenceId(randomUUID())
      scope.records.push({
        evidenceId,
        runId: scope.run.runId,
        childSessionId,
        commandId: definition.id,
        definitionHash: definition.definitionHash,
        executionBaselineHash: executionBaselineHash(scope.run.baseline),
        gate: scope.gate,
        cycle: scope.cycle,
        policyStage: scope.policyStage,
        executorStage: scope.executorStage,
        outcome: 'passed',
        exitCode: outcome.exitCode,
        signal: outcome.signal,
        startedAt,
        finishedAt: new Date().toISOString(),
        stdoutSha256: digest(stdout),
        stderrSha256: digest(stderr),
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      })
      return {
        evidenceId,
        outcome: 'passed' as const,
        stdout,
        stderr,
        stdoutTruncated: output.stdoutTruncated,
        stderrTruncated: output.stderrTruncated,
      }
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          evidenceId: { type: 'string', required: true },
          outcome: { type: 'string', required: true },
          failure: { type: 'string' },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          stdoutTruncated: { type: 'boolean', required: true },
          stderrTruncated: { type: 'boolean', required: true },
        },
      },
      render: (_args, result) => [{ type: 'text', text: resultText(result as unknown as QualityToolResult) }],
    },
  }))
}
