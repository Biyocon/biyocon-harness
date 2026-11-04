import type { ConductorRun } from '@deepseek-ai/dsh-conductor'

/**
 * Reserve a complete critic attempt against the limits captured at admission.
 * Unknown usage charges the full per-attempt allowance, so it cannot make the check pass.
 * @param run - retained run and prior critic gates.
 * @returns exact consumed, reserved and limit values with the blocking decision.
 */
export function criticBudgetReservation(run: ConductorRun): {
  consumed: number
  reserved: number
  limit: number
  exhausted: boolean
} {
  const { maxCriticInputTokensPerAttempt, maxCriticOutputTokensPerAttempt,
    maxCriticTokensPerRun } = run.budget
  const consumed = run.history.reduce((sum, record) => record.kind === 'evaluated'
    && record.analysis?.mode === 'critic'
    ? sum + (record.analysis.inputTokens === undefined || record.analysis.outputTokens === undefined
      ? maxCriticInputTokensPerAttempt + maxCriticOutputTokensPerAttempt
      : record.analysis.inputTokens + record.analysis.outputTokens) : sum, 0)
  const reserved = maxCriticInputTokensPerAttempt + maxCriticOutputTokensPerAttempt
  return { consumed, reserved, limit: maxCriticTokensPerRun,
    exhausted: consumed + reserved > maxCriticTokensPerRun }
}
