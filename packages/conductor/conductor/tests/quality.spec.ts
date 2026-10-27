import { implementationAdmission } from './intake-fixtures.ts'
import { describe, expect, it } from 'vitest'
import { ConductorRunId, createRun, executionBaselineHash, nextQualityCycle } from '../src/index.ts'

describe('Conductor quality cycles', () => {
  it('counts only the current baseline attempts for the requested gate', () => {
    const run = createRun(ConductorRunId('CON-2026-0001'), { admission: implementationAdmission(), objective: 'verify', authority: { owner: 'user' } })
    expect(nextQualityCycle(run, 'D')).toBe(1)
    const baseline = {
      scopeVersion: 'scope', planVersion: 'plan', acceptanceVersion: 'acceptance',
      allowedPaths: [], excludedPaths: [], rollbackReference: 'HEAD', qualityCommands: [],
    }
    const hash = executionBaselineHash(baseline)
    const attempt = { kind: 'evaluated' as const,
      gate: 'D' as const, stage: 'headsman' as const, decision: 'rework' as const,
      basis: [], evidenceReviewed: [], stateUpdate: 'repeat', executionBaselineHash: hash,
    }
    expect(nextQualityCycle({ ...run, baseline, history: [
      attempt,
      { ...attempt, gate: 'E', stage: 'auditor' },
      { ...attempt, executionBaselineHash: 'f'.repeat(64) },
    ] }, 'D')).toBe(2)
  })
})
