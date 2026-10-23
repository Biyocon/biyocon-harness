/** Generic sandbox runner and denial result classification. */

import { accessSync, constants, statSync } from 'node:fs'
import type { RunnerFailureRule } from './index.ts'

/** Node-local spawn codes proven to identify executable resolution or permission failure. */
const EXECUTABLE_SPAWN_CODES = new Set(['EACCES', 'ENOENT'])

/** Fatal runner evidence retained for infrastructure-error detail. */
export interface RunnerFailureMatch {
  /** The original stderr line that matched a fatal signature. */
  detail: string
}

/** Whether the caller-owned spawn cwd can be entered. */
function isUsableWorkdir(path: string): boolean {
  try {
    if (!statSync(path).isDirectory()) return false
    accessSync(path, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Attribute only Node ENOENT/EACCES failures whose error path identifies the
 * sandbox runner after independently ruling out an unusable caller cwd.
 * @param error - the original spawn rejection.
 * @param runnerProgram - provider argv[0], which establishes confinement.
 * @param workdir - caller-owned spawn cwd.
 * @returns whether the rejection has executable-specific runner evidence.
 */
export function isRunnerSpawnFailure(
  error: unknown,
  runnerProgram: string | undefined,
  workdir: string,
): boolean {
  if (runnerProgram === undefined || !isUsableWorkdir(workdir)) return false
  if (typeof error !== 'object' || error === null) return false
  const { code, path, syscall } = error as { code?: unknown; path?: unknown; syscall?: unknown }
  if (typeof code !== 'string' || !EXECUTABLE_SPAWN_CODES.has(code)) return false
  if (typeof syscall !== 'string') return false
  const exactSyscall = `spawn ${runnerProgram}`
  if (path === undefined) return syscall === exactSyscall
  if (typeof path !== 'string' || path.length === 0 || path !== runnerProgram) return false
  return syscall === 'spawn' || syscall === exactSyscall
}

/**
 * Classify one settled process against structured sandbox-runner failure rules.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text.
 * @param rules - structured runner-failure rules from the active wrap.
 * @returns the first matching fatal line, or undefined without sufficient evidence.
 */
export function classifyRunnerFailure(
  exitCode: number | null,
  stderr: string,
  rules: readonly RunnerFailureRule[],
): RunnerFailureMatch | undefined {
  if (exitCode === null || exitCode === 0) return undefined
  const lines = stderr.split(/\r?\n/)
  for (const rule of rules) {
    if (rule.allowedExitCodes !== undefined && !rule.allowedExitCodes.includes(exitCode)) continue
    const informationalLines = new Set((rule.informationalLines ?? []).map(line => line.toLowerCase()))
    const fatalSignatures = rule.fatalSignatures
      .filter(signature => signature.trim().length > 0)
      .map(signature => signature.toLowerCase())
    for (const line of lines) {
      const lowered = line.toLowerCase()
      if (informationalLines.has(lowered)) continue
      if (fatalSignatures.some(signature => lowered.includes(signature))) return { detail: line }
    }
  }
  return undefined
}

/**
 * Match a nonzero process exit against case-insensitive sandbox signatures.
 * @param exitCode - process exit code; null means signal termination.
 * @param stderr - collected stderr text.
 * @param signatures - substrings identifying the selected backend's dialect.
 * @returns whether stderr supplies matching evidence for the failed process.
 */
export function matchesSandboxSignature(
  exitCode: number | null,
  stderr: string,
  signatures: readonly string[],
): boolean {
  if (exitCode === null || exitCode === 0) return false
  const lowered = stderr.toLowerCase()
  return signatures.some(signature => lowered.includes(signature.toLowerCase()))
}
