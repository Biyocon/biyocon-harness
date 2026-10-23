/**
 * Internal sandbox-result classification helpers.
 *
 * @module @deepseek-ai/dsh-bash-sandbox/helpers
 */

import type { ShellRunResult } from '@deepseek-ai/dsh-shell'
import { matchesSandboxSignature } from '@deepseek-ai/dsh-sandbox'
export { classifyRunnerFailure, isRunnerSpawnFailure, matchesSandboxSignature as matchesSignature } from '@deepseek-ai/dsh-sandbox'

/**
 * Classify a failed run against the selected backend's denial dialect.
 * @param result - settled foreground run.
 * @param signatures - case-insensitive denial substrings from the active wrap.
 * @returns whether the failed run matches that denial dialect.
 */
export function classifyDenial(result: ShellRunResult, signatures: readonly string[]): boolean {
  return matchesSandboxSignature(result.exitCode, result.stderr.text, signatures)
}
