/** Goal RPC acknowledgements, durable transitions and rejection mapping. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import GoalService, { GoalId } from '@deepseek-ai/dsh-goal'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('goal-rpc'), payload }
}

function value<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unexpected goal RPC rejection')
  return response.result.value
}

async function harness(withGoals = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  if (withGoals) await ctx.plugin(GoalService, { defaultMaxGoalRounds: 9 })
  const session = ctx.sessions.create()
  const agent = { id: session.id, session, ctx, status: 'idle' } as unknown as Agent
  ctx.agents.register(agent)
  const api = createApiProxy(ctx, {
    cwd: '/synthetic', defaultModelSelection: () => ({ provider: 'synthetic', model: 'synthetic' }),
  })
  return { ctx, session, agent, api, sessionId: session.id }
}

describe('goal mutation RPCs', () => {
  it('acknowledges each committed transition with its new reference and preserves optional edit fields', async () => {
    const { ctx, session, agent, api, sessionId } = await harness()
    try {
      let ref = value(await api.goals.create(request({ sessionId, objective: 'First objective' }))).ref
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, objective: 'First objective', maxGoalRounds: 9, phase: 'active' })
      ref = value(await api.goals.edit(request({ sessionId, ref, objective: 'Edited objective' }))).ref
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, objective: 'Edited objective', maxGoalRounds: 9 })
      ref = value(await api.goals.edit(request({ sessionId, ref, maxGoalRounds: 12 }))).ref
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, objective: 'Edited objective', maxGoalRounds: 12 })
      ref = value(await api.goals.pause(request({ sessionId, ref }))).ref
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, phase: 'paused' })
      ref = value(await api.goals.resume(request({ sessionId, ref }))).ref
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, phase: 'active' })
      const completed = value(await api.goals.complete(request({ sessionId, ref })))
      ref = completed.ref
      expect(Object.keys(completed)).toEqual(['ref'])
      expect(ctx.goals.get(agent)).toMatchObject({ ...ref, phase: 'complete' })
      expect(value(await api.goals.clear(request({ sessionId, ref })))).toEqual({ cleared: true })
      expect(ctx.goals.get(agent)).toBeUndefined()
      expect(session.events.filter(event => event.type === 'goal/change').map(event => event.data.operation))
        .toEqual(['create', 'edit', 'edit', 'pause', 'resume', 'complete', 'clear'])
      const next = value(await api.goals.create(request({ sessionId, objective: 'Second objective', maxGoalRounds: 3 }))).ref
      expect(next.id).not.toBe(ref.id)
      expect(ctx.goals.get(agent)).toMatchObject({ ...next, maxGoalRounds: 3 })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects stale transitions and clear requests without changing the committed goal', async () => {
    const { ctx, agent, api, sessionId } = await harness()
    try {
      const stale = value(await api.goals.create(request({ sessionId, objective: 'Keep this goal' }))).ref
      const current = value(await api.goals.pause(request({ sessionId, ref: stale }))).ref
      for (const response of [
        await api.goals.complete(request({ sessionId, ref: stale })),
        await api.goals.clear(request({ sessionId, ref: stale })),
      ]) {
        expect(response.result).toMatchObject({ ok: false, error: { code: 'internal', details: { goalCode: 'GOAL_STALE_REVISION' } } })
      }
      expect(ctx.goals.get(agent)).toMatchObject({ ...current, phase: 'paused' })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('reports a missing goal service before applying a create or clear mutation', async () => {
    const { ctx, session, api, sessionId } = await harness(false)
    try {
      const ref = { id: GoalId('missing-goal'), revision: 1 }
      for (const response of [
        await api.goals.create(request({ sessionId, objective: 'Not committed' })),
        await api.goals.clear(request({ sessionId, ref })),
      ]) {
        expect(response.result).toMatchObject({
          ok: false, error: {
            code: 'internal',
            message: 'goal service is absent: neither this session\'s agent preset nor the host composition mounts @deepseek-ai/dsh-goal',
          },
        })
      }
      expect(session.events.filter(event => event.type === 'goal/change')).toEqual([])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not invent goal-domain details for an unexpected provider failure', async () => {
    const { ctx, api, sessionId } = await harness()
    try {
      vi.spyOn(ctx.goals, 'create').mockImplementation(() => { throw new Error('synthetic provider failure') })
      expect((await api.goals.create(request({ sessionId, objective: 'Not committed' }))).result).toMatchObject({
        ok: false, error: { code: 'internal', message: 'Error: synthetic provider failure', details: {} },
      })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects mutations for an unavailable session before invoking the goal service', async () => {
    const { ctx, api } = await harness()
    try {
      const sessionId = SessionId('not-present')
      const ref = { id: GoalId('not-present'), revision: 1 }
      const create = vi.spyOn(ctx.goals, 'create')
      const clear = vi.spyOn(ctx.goals, 'clear')
      expect((await api.goals.create(request({ sessionId, objective: 'Not committed' }))).result.ok).toBe(false)
      expect((await api.goals.clear(request({ sessionId, ref }))).result.ok).toBe(false)
      expect(create).not.toHaveBeenCalled()
      expect(clear).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
