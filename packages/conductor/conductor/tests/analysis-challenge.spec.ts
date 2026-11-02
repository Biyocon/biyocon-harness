import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  ANALYSIS_CHALLENGE_SCHEMA, analysisChallengeHash, validateAnalysisChallenge,
  type AnalysisChallenge, type AnalysisChallengeContext,
} from '../src/analysis-challenge.ts'
import type { ConductorMaterialId } from '../src/types.ts'

const candidateHash = 'a'.repeat(64)
const otherHash = 'b'.repeat(64)
const materialA = 'material-a' as ConductorMaterialId
const materialB = 'material-b' as ConductorMaterialId

function challenge(): Extract<AnalysisChallenge, { conclusion: 'does_not_hold' }> {
  return {
    run_id: 'CON-2026-0047', purpose: 'analysis', candidate_hash: candidateHash, candidate_version: 'v1',
    material_ids: [materialA, materialB], critic_child_id: 'critic-1', critic_attempt: 1,
    findings: [{ id: 'risk-1', severity: 'major', claim: 'The priority is unsupported.',
      rationale: 'The referenced material does not compare the alternatives.', material_ids: [materialA] }],
    conclusion: 'does_not_hold', defect: 'report', summary: 'The evidence does not justify the priority.',
  }
}

function context(): AnalysisChallengeContext {
  return {
    runId: 'CON-2026-0047', candidateHash, candidateVersion: 'v1', materialIds: [materialA, materialB],
    criticChildId: 'critic-1', producerChildId: 'producer-1', criticAttempt: 1, dispatchMode: 'critic',
    entry: 'detective', deliverable: 'recommendations', producer: 'strategist', maxSummaryCharacters: 256, previous: [],
  }
}

function analysisChallengeProblem(value: unknown, facts: AnalysisChallengeContext) {
  return validateAnalysisChallenge(value, facts).problem
}

describe('candidate-bound analysis challenge', () => {
  it('brands parsed challenge and finding material IDs', () => {
    const parsed = ANALYSIS_CHALLENGE_SCHEMA.parse(challenge())
    const materialIds: ConductorMaterialId[] = parsed.material_ids
    const findingMaterialIds: ConductorMaterialId[] = parsed.findings[0]!.material_ids
    expect(materialIds).toEqual([materialA, materialB])
    expect(findingMaterialIds).toEqual([materialA])
  })

  it('accepts holds with only minor findings and all three typed rework classes on allowed routes', () => {
    const failed = challenge()
    for (const defect of ['scope', 'plan', 'report'] as const) {
      expect(analysisChallengeProblem({ ...failed, defect }, context())).toBeUndefined()
    }
    const { defect: _defect, ...withoutDefect } = failed
    const held = { ...withoutDefect, conclusion: 'holds',
      findings: [{ ...failed.findings[0]!, severity: 'minor' }] }
    expect(ANALYSIS_CHALLENGE_SCHEMA.safeParse(held).success).toBe(true)
    expect(analysisChallengeProblem(held, context())).toBeUndefined()
    expect(validateAnalysisChallenge(held, context()).reworkTarget).toBeUndefined()
  })

  it.each([
    [null, 'malformed'],
    [[], 'malformed'],
    [{ ...challenge(), unexpected: true }, 'malformed'],
    [{ ...challenge(), run_id: ' CON-2026-0047 ' }, 'another run'],
    [{ ...challenge(), candidate_hash: 'not-a-hash' }, 'stale candidate hash'],
    [{ ...challenge(), critic_attempt: 0 }, 'another critic attempt'],
    [{ ...challenge(), summary: 'x'.repeat(257) }, 'summary exceeds'],
    [{ ...challenge(), conclusion: 'holds', defect: 'scope' }, 'malformed'],
    [{ ...challenge(), conclusion: 'does_not_hold', defect: undefined }, 'malformed'],
    [{ ...challenge(), defect: 'implementation' }, 'malformed'],
    [{ ...challenge(), findings: [{ ...challenge().findings[0], claim: ' bad ' }] }, 'malformed'],
  ])('rejects malformed or out-of-context output %#', (value, message) => {
    expect(analysisChallengeProblem(value, context())?.message).toContain(message)
  })

  it.each([
    ['run_id', 'CON-foreign', 'another run'],
    ['purpose', 'implementation', 'another purpose'],
    ['candidate_hash', otherHash, 'stale candidate hash'],
    ['candidate_version', 'v0', 'stale candidate version'],
    ['critic_child_id', 'critic-foreign', 'another critic child'],
    ['critic_attempt', 2, 'another critic attempt'],
  ] as const)('treats foreign or stale %s as an authority violation', (field, replacement, message) => {
    const problem = analysisChallengeProblem({ ...challenge(), [field]: replacement }, context())
    expect(problem?.kind).toBe('authority')
    expect(problem?.message).toContain(message)
  })

  it('rejects a producer dispatch even if the result claims to be a critic challenge', () => {
    expect(analysisChallengeProblem(challenge(), { ...context(), dispatchMode: 'producer' })).toMatchObject({ kind: 'authority' })
  })

  it('requires a different critic child from the producer, including entry C', () => {
    const problem = analysisChallengeProblem(challenge(), {
      ...context(), entry: 'devils-advocate', producer: 'devils-advocate',
      producerChildId: 'critic-1',
    })
    expect(problem?.kind).toBe('authority')
    expect(problem?.message).toContain('must differ')
  })

  it.each([
    ['missing', ['material-a']],
    ['out of order', ['material-b', 'material-a']],
    ['duplicate', ['material-a', 'material-a']],
    ['foreign', ['material-a', 'material-foreign']],
  ])('requires the exact ordered material IDs: %s', (_name, materialIds) => {
    expect(analysisChallengeProblem({ ...challenge(), material_ids: materialIds }, context())).toMatchObject({ kind: 'report' })
  })

  it('rejects duplicate finding IDs and unknown or repeated finding material IDs', () => {
    const finding = challenge().findings[0]!
    for (const findings of [
      [finding, finding],
      [{ ...finding, material_ids: ['material-foreign'] }],
      [{ ...finding, material_ids: ['material-a', 'material-a'] }],
    ]) {
      expect(analysisChallengeProblem({ ...challenge(), findings }, context())).toMatchObject({ kind: 'report' })
    }
  })

  it('rejects contradictory conclusions and a plan defect on a Detective-produced report', () => {
    const failed = challenge()
    for (const severity of ['major', 'critical'] as const) {
      const { defect: _defect, ...withoutDefect } = failed
      expect(analysisChallengeProblem({ ...withoutDefect, conclusion: 'holds',
        findings: [{ ...failed.findings[0]!, severity }] }, context())?.message).toContain('holds cannot')
    }
    for (const findings of [[], [{ ...failed.findings[0]!, severity: 'minor' }]]) {
      expect(analysisChallengeProblem({ ...failed, findings }, context())?.message).toContain('requires a major or critical')
    }
    expect(analysisChallengeProblem({ ...failed, defect: 'plan' },
      { ...context(), deliverable: 'answer', producer: 'detective' })?.message).toContain('not on the admitted route')
  })

  it('checks defect targets against all admitted entry and deliverable routes', () => {
    for (const entry of ['detective', 'strategist', 'devils-advocate'] as const) {
      for (const deliverable of ['answer', 'recommendations'] as const) {
        const producer = entry === 'detective' && deliverable === 'recommendations' ? 'strategist' : entry
        for (const defect of ['scope', 'plan', 'report'] as const) {
          const allowed = defect === 'report' || (defect === 'scope' && entry === 'detective')
            || (defect === 'plan' && (entry === 'strategist' || (entry === 'detective' && deliverable === 'recommendations')))
          const result = validateAnalysisChallenge({ ...challenge(), defect }, { ...context(), entry, deliverable, producer })
          expect(result.problem === undefined).toBe(allowed)
          if (allowed) {
            expect(result.reworkTarget).toBe(defect === 'scope' ? 'detective'
              : defect === 'plan' ? 'strategist' : producer)
          }
        }
      }
    }
  })

  it('fails loud when the runtime supplies an invalid summary limit or producer identity', () => {
    for (const maxSummaryCharacters of [0, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => analysisChallengeProblem(challenge(), { ...context(), maxSummaryCharacters })).toThrow(/positive safe integer/)
    }
    expect(() => analysisChallengeProblem(challenge(), { ...context(), producer: 'detective' })).toThrow(/producer does not match/)
  })

  it('rejects stale stored hashes, reused child/attempt and a second challenge of one candidate', () => {
    const previous = challenge()
    const { defect: _defect, ...withoutDefect } = previous
    const contradictoryPrevious = { ...withoutDefect, conclusion: 'holds' } as AnalysisChallenge
    const current = { ...challenge(), candidate_hash: otherHash, candidate_version: 'v2', critic_child_id: 'critic-2', critic_attempt: 2 }
    const currentContext = { ...context(), candidateHash: otherHash, candidateVersion: 'v2', criticChildId: 'critic-2', criticAttempt: 2 }
    for (const [prior, message] of [
      [{ challenge: { ...previous, purpose: 'implementation' } as unknown as AnalysisChallenge, hash: otherHash }, 'stored analysis challenge is malformed'],
      [{ challenge: contradictoryPrevious, hash: otherHash }, 'stored analysis challenge is semantically invalid'],
      [{ challenge: previous, hash: otherHash }, 'hash disagrees'],
      [{ challenge: { ...previous, critic_child_id: 'critic-2' }, hash: analysisChallengeHash({ ...previous, critic_child_id: 'critic-2' }) }, 'already used'],
      [{ challenge: { ...previous, critic_attempt: 2 }, hash: analysisChallengeHash({ ...previous, critic_attempt: 2 }) }, 'must increase'],
      [{ challenge: { ...previous, candidate_hash: otherHash }, hash: analysisChallengeHash({ ...previous, candidate_hash: otherHash }) }, 'already has'],
    ] as const) {
      expect(analysisChallengeProblem(current, { ...currentContext, previous: [prior] })?.message).toContain(message)
    }
    expect(analysisChallengeProblem(current, {
      ...currentContext, previous: [{ challenge: previous, hash: analysisChallengeHash(previous) }],
    })).toBeUndefined()
  })

  it('rejects a reused critic attempt when the candidate and critic child both change', () => {
    const previous = challenge()
    const current = { ...challenge(), candidate_hash: otherHash, candidate_version: 'v2', critic_child_id: 'critic-2' }
    const facts = { ...context(), candidateHash: otherHash, candidateVersion: 'v2', criticChildId: 'critic-2',
      previous: [{ challenge: previous, hash: analysisChallengeHash(previous) }] }
    const problem = analysisChallengeProblem(current, facts)
    expect(problem?.kind).toBe('authority')
    expect(problem?.message).toContain('attempt must increase')
  })

  it('rejects a lower unused attempt on a new candidate', () => {
    const previous = { ...challenge(), critic_attempt: 3 }
    const current = { ...challenge(), candidate_hash: otherHash, candidate_version: 'v2',
      critic_child_id: 'critic-2', critic_attempt: 2 }
    const facts = { ...context(), candidateHash: otherHash, candidateVersion: 'v2',
      criticChildId: 'critic-2', criticAttempt: 2,
      previous: [{ challenge: previous, hash: analysisChallengeHash(previous) }] }
    const problem = analysisChallengeProblem(current, facts)
    expect(problem?.kind).toBe('authority')
    expect(problem?.message).toContain('attempt must increase')
  })

  it('rejects every semantic contradiction before hashing or trusting a stored challenge', () => {
    const original = challenge()
    const finding = original.findings[0]!
    const { defect: _defect, ...withoutDefect } = original
    const invalid = [
      { challenge: { ...original, material_ids: [materialA, materialA] }, message: 'material IDs must be unique' },
      { challenge: { ...original, findings: [finding, finding] }, message: 'finding IDs must be unique' },
      { challenge: { ...original, findings: [{ ...finding, material_ids: ['foreign' as ConductorMaterialId] }] },
        message: 'their own materials' },
      { challenge: { ...original, findings: [{ ...finding, material_ids: [materialA, materialA] }] },
        message: 'their own materials' },
      { challenge: { ...withoutDefect, conclusion: 'holds', findings: [finding] } as AnalysisChallenge,
        message: 'holds cannot' },
      { challenge: { ...original, findings: [{ ...finding, severity: 'minor' }] } as AnalysisChallenge,
        message: 'requires a major or critical' },
    ]
    for (const { challenge: result, message } of invalid) {
      expect(analysisChallengeProblem(result, context())?.message).toContain(message)
      expect(() => analysisChallengeHash(result)).toThrow(message)
      const current = { ...original, candidate_hash: otherHash, candidate_version: 'v2',
        critic_child_id: 'critic-2', critic_attempt: 2 }
      const facts = { ...context(), candidateHash: otherHash, candidateVersion: 'v2',
        criticChildId: 'critic-2', criticAttempt: 2,
        previous: [{ challenge: result, hash: otherHash }] }
      const problem = analysisChallengeProblem(current, facts)
      expect(problem?.kind).toBe('authority')
      expect(problem?.message).toContain(message)
    }
  })

  it('hashes validated content in canonical field order', () => {
    const original = challenge()
    const reordered = {
      summary: original.summary, conclusion: original.conclusion, findings: original.findings,
      critic_attempt: original.critic_attempt, critic_child_id: original.critic_child_id,
      material_ids: original.material_ids, candidate_version: original.candidate_version,
      candidate_hash: original.candidate_hash, purpose: original.purpose, run_id: original.run_id,
      defect: 'report',
    }
    expect(analysisChallengeHash(ANALYSIS_CHALLENGE_SCHEMA.parse(reordered))).toBe(analysisChallengeHash(original))
    expect(analysisChallengeHash(original)).toMatch(/^[a-f0-9]{64}$/)
    expect(validateAnalysisChallenge(original, context())).toMatchObject({ challenge: original, hash: analysisChallengeHash(original) })
    expect(() => analysisChallengeHash({ ...original, conclusion: 'holds', defect: 'report' } as unknown as AnalysisChallenge))
      .toThrow()
    const { defect: _defect, ...withoutDefect } = original
    expect(() => analysisChallengeHash({ ...withoutDefect, conclusion: 'holds' }))
      .toThrow(/holds cannot/)
    expect(() => analysisChallengeHash({ ...original, findings: [] })).toThrow(/requires a major or critical/)
  })

  it('preserves valid candidate bindings and changes the digest when a finding changes (property)', () => {
    fc.assert(fc.property(fc.stringMatching(/^[A-Za-z0-9]{1,24}$/), (claim) => {
      const original = challenge()
      const changed = { ...original, findings: [{ ...original.findings[0]!, claim: `${claim}x` }] }
      expect(analysisChallengeProblem(changed, context())).toBeUndefined()
      expect(analysisChallengeHash(changed)).toBe(analysisChallengeHash({ ...changed }))
      expect(analysisChallengeHash(changed)).not.toBe(analysisChallengeHash(original))
    }), { numRuns: 100 })
  })

  it('requires a substantive finding for every failing conclusion (property)', () => {
    fc.assert(fc.property(fc.constantFrom('minor', 'major', 'critical'), (severity) => {
      const candidate = { ...challenge(), findings: [{ ...challenge().findings[0]!, severity }] }
      const valid = analysisChallengeProblem(candidate, context()) === undefined
      expect(valid).toBe(severity !== 'minor')
    }), { numRuns: 100 })
  })
})
