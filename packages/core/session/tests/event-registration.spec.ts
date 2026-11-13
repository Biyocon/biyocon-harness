import { Context } from '@deepseek-ai/cordis'
import { expect, it } from 'vitest'
import SessionStore from '../src/index.ts'

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
