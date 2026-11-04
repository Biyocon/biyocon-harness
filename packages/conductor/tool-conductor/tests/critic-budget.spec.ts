import { describe, expect, it } from 'vitest'
import type { ConductorRun } from '@deepseek-ai/dsh-conductor'
import { criticBudgetReservation } from '../src/critic-budget.ts'

describe('critic token reservation', () => {
  it('charges an unmetered critic gate as a full attempt and blocks the next dispatch', () => {
    const run = { budget: { maxCriticInputTokensPerAttempt: 10, maxCriticOutputTokensPerAttempt: 5,
      maxCriticTokensPerRun: 25 }, history: [{ kind: 'evaluated', analysis: { mode: 'critic' } }] } as ConductorRun
    expect(criticBudgetReservation(run)).toEqual({ consumed: 15, reserved: 15, limit: 25, exhausted: true })
    const partial = { ...run, history: [{ kind: 'evaluated', analysis: { mode: 'critic', inputTokens: 3 } }] } as ConductorRun
    expect(criticBudgetReservation(partial)).toEqual({ consumed: 15, reserved: 15, limit: 25, exhausted: true })
  })

  it('uses recorded usage when present and admits a complete remaining attempt', () => {
    const run = { budget: { maxCriticInputTokensPerAttempt: 10, maxCriticOutputTokensPerAttempt: 5,
      maxCriticTokensPerRun: 25 }, history: [{ kind: 'evaluated', analysis: { mode: 'critic',
      inputTokens: 3, outputTokens: 2 } }, { kind: 'skipped' }] } as ConductorRun
    expect(criticBudgetReservation(run)).toEqual({ consumed: 5, reserved: 15, limit: 25, exhausted: false })
  })
})
