import { CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import * as conductor from '../src/index.ts'
import { conductorChildrenProjection as projection } from '../src/child-projection.ts'
import { ANALYSIS_CHALLENGE_SCHEMA, analysisChallengeHash } from '../src/analysis-challenge.ts'
import type { ConductorChild } from '../src/child-types.ts'

describe('durable Conductor child catalog', () => {
  it('replays exact child identities, replaces one child, and clears inherited seed children', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    await ctx.plugin(SessionProjections)
    const fiber = await ctx.plugin(conductor)
    const session = ctx.sessions.create(SessionId('catalog-parent'))
    session.append('turn/start', { turn: 1 })
    const child: ConductorChild = {
      childId: SessionId('first'), runId: conductor.ConductorRunId('CON-2026-0001'), role: 'detective',
      attempt: 1, historyOffset: 0, status: 'running',
    }
    session.append('conductor/child', child)
    session.append('conductor/child', { ...child, status: 'completed' })
    let state = projection.init()
    for (const event of session.events) state = projection.apply(state, event)
    expect(projection.view(state)).toEqual({ first: { ...child, status: 'completed' } })
    expect(ctx.sessionProjections.snapshot(session).values.conductorChildren).toEqual(projection.view(state))
    expect(projection.schema.safeParse(state).success).toBe(true)
    const critic: ConductorChild = { ...child, childId: SessionId('critic'), role: 'devils-advocate',
      mode: 'critic', criticAttempt: 1, status: 'completed', gate: { id: 'C', decision: 'pass', reworks: 0,
        limit: 2, challengeConclusion: 'holds' } }
    expect(projection.schema.safeParse({ critic }).success).toBe(true)
    const result = ANALYSIS_CHALLENGE_SCHEMA.parse({ run_id: critic.runId, purpose: 'analysis',
      candidate_hash: 'a'.repeat(64), candidate_version: 'v1', material_ids: ['material-' + 'b'.repeat(64)],
      critic_child_id: critic.childId, critic_attempt: 1, conclusion: 'holds', summary: 'A bounded review.',
      findings: [{ id: 'minor-1', severity: 'minor', claim: '<script>literal</script>',
        rationale: '[literal](https://example.invalid)', material_ids: ['material-' + 'b'.repeat(64)] }] })
    const details = { hash: analysisChallengeHash(result), result }
    const withDetails = { ...critic, gate: { ...critic.gate, challenge: details } }
    expect(projection.schema.parse({ critic: withDetails })).toEqual({ critic: withDetails })
    expect(projection.schema.safeParse({ critic: { ...withDetails,
      gate: { ...withDetails.gate, challengeConclusion: undefined } } }).success).toBe(false)
    for (const changed of [{ run_id: 'CON-2026-0002' }, { critic_child_id: 'other' },
      { critic_attempt: 2 }, { candidate_hash: 'c'.repeat(64) }, { summary: 'Changed text.' },
      { conclusion: 'does_not_hold', defect: 'report', findings: [{ ...result.findings[0], severity: 'major' }] },
      { findings: [...result.findings, ...result.findings] }]) {
      expect(projection.schema.safeParse({ critic: { ...withDetails,
        gate: { ...withDetails.gate, challenge: { ...details, result: { ...result, ...changed } } } } }).success).toBe(false)
    }
    expect(projection.schema.safeParse({ critic: { ...critic, criticAttempt: undefined } }).success).toBe(false)
    expect(projection.schema.safeParse({ critic: { ...critic, mode: 'producer' } }).success).toBe(false)
    const reset = { type: 'session/end-seed', data: {} } as Parameters<typeof projection.apply>[1]
    expect(projection.apply(state, reset)).toEqual({})
    await fiber.dispose()
    expect(ctx.sessionProjections.snapshot(session).values.conductorChildren).toBeUndefined()
    const reloaded=await ctx.plugin(conductor)
    expect(ctx.sessionProjections.snapshot(session).values.conductorChildren).toEqual(projection.view(state))
    await reloaded.dispose()
  })
})
