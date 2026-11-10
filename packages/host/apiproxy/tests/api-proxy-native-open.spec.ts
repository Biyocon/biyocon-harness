/** Default native opener delegation without launching an operating-system app. */
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import { openNativePath, openNativeTextFile } from '../src/native-path-opener.ts'
import { RpcId } from '../src/api/rpc.ts'

vi.mock('../src/native-path-opener.ts', () => ({
  canOpenNativePath: vi.fn(() => true),
  openNativePath: vi.fn(() => Promise.resolve()),
  openNativeTextFile: vi.fn(() => Promise.resolve()),
}))

it('uses the default application for a path and the text editor for the host-resolved settings document', async () => {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  ctx.provide('settings', { prepareDocument: () => Promise.resolve('/synthetic/settings.yaml') } as never)
  try {
    const api = createApiProxy(ctx, {
      cwd: '/synthetic', defaultModelSelection: () => ({ provider: 'synthetic', model: 'synthetic' }),
    })
    const signal = new AbortController().signal
    const rpcId = RpcId('native-open')
    expect((await api.host.openPath({ rpcId, payload: { path: '/synthetic/report.pdf' } }, signal)).result)
      .toEqual({ ok: true, value: { opened: true } })
    expect((await api.settings.openDocument({ rpcId, payload: {} }, signal)).result)
      .toEqual({ ok: true, value: { opened: true } })
    expect(openNativePath).toHaveBeenCalledExactlyOnceWith('/synthetic/report.pdf', signal)
    expect(openNativeTextFile).toHaveBeenCalledExactlyOnceWith('/synthetic/settings.yaml', signal)
  } finally {
    await ctx.fiber.dispose()
  }
})
