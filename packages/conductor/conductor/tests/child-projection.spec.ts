import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import * as conductor from '../src/index.ts'
import { conductorChildrenProjection as projection } from '../src/child-projection.ts'
import type { ConductorChild } from '../src/child-types.ts'

describe('durable Conductor child catalog', () => {
  it('replays exact child identities, replaces one child, and clears inherited seed children', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
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
