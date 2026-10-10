/** Deployment-owned Conductor quality-command catalog. */

import { createHash } from 'node:crypto'
import { isAbsolute, normalize, sep } from 'node:path'
import { QualityCommandId } from '@deepseek-ai/dsh-conductor'
import type { QualityPolicyStage } from '@deepseek-ai/dsh-conductor'

/** Configured exact-argv quality command. */
export interface QualityCommandConfig {
  /** Opaque normalized id exposed to specialists. */
  id: string
  /** Command purpose text safe to include in a model prompt. */
  modelSafeDescription: string
  /** Exact executable and argument vector; shell interpreters are forbidden. */
  argv: string[]
  /** Workspace-relative working directory. */
  cwd: string
  /** Workspace-relative writable root required by workspace-write mode. */
  writeRoot?: string
  /** Specialist policy stages permitted to execute the command. */
  allowedStages: QualityPolicyStage[]
  /** Required filesystem confinement mode. */
  sandboxMode: 'read-only' | 'workspace-write'
  /** Maximum execution time in milliseconds. */
  timeoutMs: number
  /** Maximum collected bytes for each output stream. */
  maxOutputBytes: number
  /** Termination grace period in milliseconds. */
  graceMs: number
}

/** Validated immutable command definition with its stable digest. */
export interface QualityCommandDefinition extends Omit<QualityCommandConfig, 'id' | 'argv' | 'allowedStages'> {
  id: ReturnType<typeof QualityCommandId>
  argv: readonly [string, ...string[]]
  allowedStages: readonly QualityPolicyStage[]
  definitionHash: string
}

const SHELL_PROGRAMS = new Set(['bash', 'sh', 'zsh', 'fish', 'cmd', 'cmd.exe', 'powershell', 'powershell.exe', 'pwsh', 'pwsh.exe'])

function normalizedText(value: string, field: string): string {
  if (value.length === 0 || value !== value.trim()) throw new TypeError(`${field} must be a non-empty normalized string`)
  return value
}

function relativePath(value: string, field: string): string {
  normalizedText(value, field)
  if (isAbsolute(value)) throw new TypeError(`${field} must be workspace-relative`)
  const normalized = normalize(value)
  if (normalized === '..' || normalized.startsWith(`..${sep}`)) throw new TypeError(`${field} must stay inside the workspace`)
  return normalized
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${field} must be a positive safe integer`)
  return value
}

/**
 * Validate and hash the deployment catalog.
 * @param configs - deployment-owned command definitions.
 * @returns immutable command lookup keyed by opaque id.
 */
export function resolveQualityCatalog(configs: readonly QualityCommandConfig[]): ReadonlyMap<string, QualityCommandDefinition> {
  const catalog = new Map<string, QualityCommandDefinition>()
  for (const config of configs) {
    const id = normalizedText(config.id, 'qualityCommands.id')
    if (catalog.has(id)) throw new TypeError(`qualityCommands contains duplicate id "${id}"`)
    const description = normalizedText(config.modelSafeDescription, `qualityCommands.${id}.modelSafeDescription`)
    const rawArgv: unknown = config.argv
    if (!Array.isArray(rawArgv) || rawArgv.length === 0
      || rawArgv.some(value => typeof value !== 'string' || value.length === 0)) {
      throw new TypeError(`qualityCommands.${id}.argv must contain exact non-empty arguments`)
    }
    const argv = rawArgv as string[]
    const [executable] = argv
    if (executable === undefined) throw new TypeError(`qualityCommands.${id}.argv must not be empty`)
    const program = executable.replace(/^.*[\\/]/, '').toLowerCase()
    if (SHELL_PROGRAMS.has(program)) throw new TypeError(`qualityCommands.${id}.argv must not invoke a shell interpreter`)
    const rawAllowedStages: unknown = config.allowedStages
    if (!Array.isArray(rawAllowedStages) || rawAllowedStages.length === 0
      || rawAllowedStages.some(stage => stage !== 'headsman' && stage !== 'auditor')
      || new Set(rawAllowedStages).size !== rawAllowedStages.length) {
      throw new TypeError(`qualityCommands.${id}.allowedStages must contain distinct headsman/auditor stages`)
    }
    const allowedStages = rawAllowedStages as QualityPolicyStage[]
    const rawSandboxMode: unknown = config.sandboxMode
    if (rawSandboxMode !== 'read-only' && rawSandboxMode !== 'workspace-write') {
      throw new TypeError(`qualityCommands.${id}.sandboxMode is invalid`)
    }
    const sandboxMode: QualityCommandConfig['sandboxMode'] = rawSandboxMode
    const cwd = relativePath(config.cwd, `qualityCommands.${id}.cwd`)
    const writeRoot = config.writeRoot === undefined
      ? undefined
      : relativePath(config.writeRoot, `qualityCommands.${id}.writeRoot`)
    if (sandboxMode === 'read-only' && writeRoot !== undefined) {
      throw new TypeError(`qualityCommands.${id} read-only command cannot set writeRoot`)
    }
    if (sandboxMode === 'workspace-write' && writeRoot === undefined) {
      throw new TypeError(`qualityCommands.${id} workspace-write command requires writeRoot`)
    }
    if (allowedStages.includes('auditor') && sandboxMode !== 'read-only') {
      throw new TypeError(`qualityCommands.${id} Auditor command must be read-only`)
    }
    const normalized = {
      id,
      modelSafeDescription: description,
      argv: Object.freeze([...argv]) as readonly [string, ...string[]],
      cwd,
      ...writeRoot === undefined ? {} : { writeRoot },
      allowedStages: Object.freeze([...allowedStages]),
      sandboxMode,
      timeoutMs: positiveInteger(config.timeoutMs, `qualityCommands.${id}.timeoutMs`),
      maxOutputBytes: positiveInteger(config.maxOutputBytes, `qualityCommands.${id}.maxOutputBytes`),
      graceMs: positiveInteger(config.graceMs, `qualityCommands.${id}.graceMs`),
    }
    const definitionHash = createHash('sha256').update(JSON.stringify(normalized)).digest('hex')
    catalog.set(id, Object.freeze({ ...normalized, id: QualityCommandId(id), definitionHash }))
  }
  return catalog
}
