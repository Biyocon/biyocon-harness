import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import { CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import ConductorSessionStore from '../src/index.ts'

it('publishes sessions only with all replay registrations, and removes them on provider unload', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionProjections)
  let observed = false
  ctx.inject(['sessions', 'sessionProjections'], (child) => {
    for (const type of CONDUCTOR_SESSION_EVENT_TYPES) expect(child.sessions.supportsEventType(type)).toBe(true)
    expect(child.sessionProjections.snapshot(Session.create(SessionId('synthetic-provider'))).values)
      .toEqual({ conductorChildren: {}, conductorUnavailableRuns: {} })
    observed = true
  })
  try {
    const provider = await ctx.plugin(ConductorSessionStore)
    await expect.poll(() => observed).toBe(true)
    await provider.dispose()
    expect(ctx.get('sessions')).toBeUndefined()
    expect(ctx.sessionProjections.snapshot(Session.create(SessionId('synthetic-unloaded'))).values).toEqual({})
  } finally {
    await ctx.fiber.dispose()
  }
})
