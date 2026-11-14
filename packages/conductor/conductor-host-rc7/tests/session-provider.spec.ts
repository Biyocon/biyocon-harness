import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as Conductor from '@deepseek-ai/dsh-conductor'

it('the presentation plugin owns both projections but grants no event admission', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SessionStore)
  try {
    const owner = await ctx.plugin(Conductor)
    expect(ctx.get('conductorPresentation')).toBe(true)
    expect(ctx.sessions.supportsEventType('conductor/checkpoint')).toBe(false)
    expect(ctx.sessionProjections.snapshot(Session.create(SessionId('synthetic-provider'))).values)
      .toEqual({ conductorChildren: {}, conductorUnavailableRuns: {} })
    await owner.dispose()
    expect(ctx.get('conductorPresentation')).toBeUndefined()
    expect(ctx.sessionProjections.snapshot(Session.create(SessionId('synthetic-unloaded'))).values).toEqual({})
  } finally { await ctx.fiber.dispose() }
})
