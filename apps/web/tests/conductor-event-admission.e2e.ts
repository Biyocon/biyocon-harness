import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { Session, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionHeader } from '@deepseek-ai/dsh-session'
import JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor'
import type {} from '@deepseek-ai/dsh-session-projection-cache'
import type {} from '@deepseek-ai/dsh-agent-loop'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { expect, it } from 'vitest'
import { launchWebScaffold } from './scaffold.ts'

type HistoryResponse = { result:
  | { ok: true; value: { events: { event: { type: string } }[]; projections: { values: Record<string, unknown> } } }
  | { ok: false; error: { message: string } }
}

async function optionalFile(path: string): Promise<Buffer | undefined> {
  try { return await readFile(path) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    return undefined
  }
}

it.each([true, false])('admits history before Web boot settles, with Conductor bundle = %s', async (enabled) => {
  const release = Promise.withResolvers<undefined>()
  const paused = Promise.withResolvers<undefined>()
  const registrationBlocked = Promise.withResolvers<undefined>()
  const releaseRegistration = Promise.withResolvers<undefined>()
  const listening = Promise.withResolvers<Context>()
  const ready = Promise.withResolvers<Context>()
  const id = SessionId('synthetic-startup-history')
  const runId = ConductorRunId('CON-2026-0037')
  let header!: SessionHeader
  let artifact = ''
  let cachePath = ''
  let settled = false
  let modelCalls = 0
  let toolCalls = 0
  const launching = launchWebScaffold({
    conductorHostBundle: enabled,
    prepareHost: async (ctx, paths) => {
      const seed = new Context()
      await seed.plugin(SessionStore)
      await seed.plugin(JsonlPersistence, { root: paths.persistenceRoot })
      try {
        const session = Session.create(id, [], { version: 0, id, createdAt: 1, cwd: paths.workspaceCwd })
        session.append('turn/start', { turn: 1 })
        session.append('user/message', createUserMessage({ source: { kind: 'user' },
          content: [{ type: 'text', text: 'Synthetic startup history.' }] }), { surfaceOp: 'append' })
        session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
        session.append('conductor/checkpoint', { runId, record: JSON.stringify({ recordFormatVersion: 4 }) })
        header = session.header
        await seed.sessionPersistence.create(header)
        await seed.sessionPersistence.append(id, session.events)
        artifact = seed.sessionPersistence.locate(header)!.path
      } finally { await seed.fiber.dispose() }
      cachePath = join(paths.workspaceCwd, '.dsh-storages/session_projcache.json')
      ctx.on('loader/patch-context', async (entry, next) => {
        if (enabled && entry.options.id === 'conductor-presentation') {
          registrationBlocked.resolve(undefined)
          await releaseRegistration.promise
        }
        if (entry.options.id === 'client-hmr') {
          paused.resolve(undefined)
          await release.promise
        }
        await next()
      })
      ctx.on('agent/request', () => { modelCalls++; throw new Error('unexpected model request during startup history read') })
      ctx.on('tools/pre-execute', () => { toolCalls++; throw new Error('unexpected tool execution during startup history read') })
      ctx.inject(['webServer', 'apiProxy', 'sessionProjectionCache', 'agentLoop', 'agents', 'sessions'], (child) => { ready.resolve(child) })
      ctx.inject(['webServer'], (child) => { listening.resolve(child) })
    },
  })
  void launching.then(() => { settled = true }, () => { settled = true })
  try {
    if (enabled) {
      await registrationBlocked.promise
      const early = await listening.promise
      expect(early.get('sessions')).toBeUndefined()
      const response = await fetch(`http://127.0.0.1:${early.webServer.port}/api/session.history`, { method: 'POST' })
      expect(response.status).toBe(404)
      releaseRegistration.resolve(undefined)
    }
    await paused.promise
    const ctx = await ready.promise
    expect(settled).toBe(false)
    const bytes = await readFile(artifact)
    const cacheBefore = await optionalFile(cachePath)
    let history: HistoryResponse | undefined
    await expect.poll(async () => {
      const response = await fetch(`http://127.0.0.1:${ctx.webServer.port}/api/session.history`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'startup-history', method: 'session.history', payload: { sessionId: id } }),
      })
      if (response.status === 404) return false
      history = await response.json() as HistoryResponse
      return true
    }).toBe(true)
    expect(settled).toBe(false)
    expect(await readFile(artifact)).toEqual(bytes)
    if (enabled) {
      expect(history!.result.ok).toBe(true)
      if (history!.result.ok) {
        expect(history!.result.value.events.some(item => item.event.type === 'conductor/checkpoint')).toBe(true)
        expect(history!.result.value.projections.values.conductorUnavailableRuns).toEqual({ [runId]: { format: 4 } })
      }
      const handle = await ctx.agents.resume({ resumeSessionId: id })
      await handle.agent.whenIdle()
      await handle.dispose()
    } else {
      expect(history!.result.ok).toBe(false)
      if (!history!.result.ok) expect(history!.result.error.message).toContain('enable the compatible plugin bundle')
      await expect(ctx.agents.resume({ resumeSessionId: id })).rejects.toThrow('enable the compatible plugin bundle')
      await expect(ctx.sessionProjectionCache.coldSnapshot(id)).rejects.toThrow('enable the compatible plugin bundle')
      expect(ctx.sessionProjectionCache.cachedSnapshot(header)).toBeUndefined()
      expect(await optionalFile(cachePath)).toEqual(cacheBefore)
      expect(await readFile(artifact)).toEqual(bytes)
      expect(ctx.sessions.get(id)).toBeUndefined()
    }
    expect(settled).toBe(false)
    expect(modelCalls).toBe(0)
    expect(toolCalls).toBe(0)
  } finally {
    releaseRegistration.resolve(undefined)
    release.resolve(undefined)
    const scaffold = await launching
    await scaffold.close()
  }
})

it('refuses unadmitted live writes and attached history after event admission is revoked', async () => {
  const scaffold = await launchWebScaffold({ conductorHostBundle: false })
  let modelCalls = 0
  scaffold.ctx.on('agent/request', () => { modelCalls++; throw new Error('unexpected model call in live admission test') })
  try {
    const handle = await scaffold.ctx.agents.create({ sessionId: SessionId('synthetic-live-admission'),
      meta: { cwd: scaffold.workspaceCwd }, agentOptions: { provider: 'synthetic', model: 'synthetic' } })
    const session = handle.agent.session
    const record = { runId: ConductorRunId('CON-2026-0091'), record: JSON.stringify({ recordFormatVersion: 4 }) }
    const before = session.events
    expect(() => session.append('conductor/checkpoint', record)).toThrow('not admitted')
    expect(session.events).toBe(before)
    const history = async () => {
      const response = await fetch(`http://127.0.0.1:${scaffold.ctx.webServer.port}/api/session.history`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'live-admission', method: 'session.history', payload: { sessionId: session.id } }),
      })
      return await response.json() as HistoryResponse
    }
    const clean = await history()
    expect(clean.result.ok).toBe(true)
    if (clean.result.ok) expect(clean.result.value.events.some(item => item.event.type === 'conductor/checkpoint')).toBe(false)
    const release = scaffold.ctx.sessions.registerEventTypes(['conductor/checkpoint'])
    session.append('conductor/checkpoint', record)
    expect(session.events.at(-1)?.type).toBe('conductor/checkpoint')
    release()
    const refused = await history()
    expect(refused.result.ok).toBe(false)
    if (!refused.result.ok) expect(refused.result.error.message).toContain('not admitted')
    expect(modelCalls).toBe(0)
    scaffold.ctx.sessions.registerEventTypes(['conductor/checkpoint'])
    await handle.dispose()
  } finally { await scaffold.close() }
})
