import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import SessionStore, { type Config } from '../src/index.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'optional-fixture/result': { value: string }
  }
}

it('admits plugin events only while a registering fiber remains mounted', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  try {
    expect(ctx.sessions.supportsEventType('turn/start')).toBe(true)
    expect(ctx.sessions.supportsEventType('optional-fixture/result')).toBe(false)
    const owner = ctx.plugin(Object.assign((child: Context) => {
      child.sessions.registerEventTypes(['optional-fixture/result', 'optional-fixture/result'])
    }, { inject: ['sessions'] }))
    await owner
    expect(ctx.sessions.supportsEventType('optional-fixture/result')).toBe(true)
    let release = () => {}
    const second = ctx.plugin(Object.assign((child: Context) => {
      release = child.sessions.registerEventTypes(['optional-fixture/result'])
    }, { inject: ['sessions'] }))
    await second
    await owner.dispose()
    expect(ctx.sessions.supportsEventType('optional-fixture/result')).toBe(true)
    release()
    expect(ctx.sessions.supportsEventType('optional-fixture/result')).toBe(false)
    await second.dispose()
    expect(ctx.sessions.supportsEventType('turn/start')).toBe(true)
  } finally {
    await ctx.fiber.dispose()
  }
})


it('installs configured bundle names before the sessions service becomes injectable', async () => {
  const ctx = new Context()
  let observed = false
  ctx.inject(['sessions'], (child) => {
    expect(child.sessions.supportsEventType('first/event')).toBe(true)
    expect(child.sessions.supportsEventType('second/event')).toBe(true)
    expect(child.sessions.supportsEventType('indirect/event')).toBe(false)
    observed = true
  })
  try {
    await ctx.plugin(SessionStore, { sessionEventTypes: ['first/event', 'second/event'] })
    await expect.poll(() => observed).toBe(true)
  } finally { await ctx.fiber.dispose() }
})

it('rejects malformed event names at the session Config parser', () => {
  const parse = SessionStore.Config as (input: unknown) => Config
  for (const sessionEventTypes of ['x', [''], ['contains space'], ['x\n'], [17]]) {
    expect(() => parse({ sessionEventTypes })).toThrow()
  }
  expect(parse({})).toEqual({ sessionEventTypes: [] })
  expect(parse({ sessionEventTypes: null })).toEqual({ sessionEventTypes: [] })
})
