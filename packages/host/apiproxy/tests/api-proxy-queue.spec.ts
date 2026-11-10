/** Queue edits, steering and cancellation through the real durable Inbox. */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { AttachmentId } from '@deepseek-ai/dsh-attachment'
import { createUserMessage, MessageId } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createApiProxy } from '../src/api-proxy.ts'
import { RpcId } from '../src/api/rpc.ts'
import type { RpcRequest } from '../src/api/rpc.ts'
import type { MuxFrame } from '../src/api/index.ts'

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId('queue-rpc'), payload }
}

async function nextFrame(stream: AsyncIterator<RpcRequest<MuxFrame>>): Promise<MuxFrame> {
  const next = await stream.next()
  if (next.done === true) throw new Error('mux stream ended before the expected frame')
  return next.value.payload
}

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const session = ctx.sessions.create()
  const inbox = new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} })
  const steer = vi.fn((message: Parameters<Agent['steer']>[0]) => { inbox.append('next-step', message) })
  const cancel = vi.fn()
  const agent = { id: session.id, session, ctx, inbox, steer, cancel, status: 'running' } as unknown as Agent
  ctx.agents.register(agent)
  const api = createApiProxy(ctx, {
    cwd: '/synthetic', defaultModelSelection: () => ({ provider: 'synthetic', model: 'synthetic' }),
  })
  return { ctx, session, agent, inbox, api, sessionId: session.id, steer, cancel }
}

describe('pending queue RPCs', () => {
  it('replays pending queue placements and forwards an unowned inbox append only as a log event', async () => {
    const { ctx, inbox, api, sessionId } = await harness()
    const abort = new AbortController()
    try {
      const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued' }] })
      const steering = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Steering' }] })
      const context = createUserMessage({ source: { kind: 'plugin', plugin: 'synthetic' }, content: [{ type: 'text', text: 'Context' }] })
      inbox.append('next-turn', queued)
      inbox.append('next-step', steering)
      inbox.append('next-step', context)
      const unowned = ctx.sessions.create(SessionId('session-before-agent'))
      const stream = api.events.mux(request({}), abort.signal)[Symbol.asyncIterator]()
      const frames = [await nextFrame(stream), await nextFrame(stream), await nextFrame(stream)]
      expect(frames.filter(frame => frame?.type === 'session/subscribed')).toHaveLength(2)
      expect(frames.find(frame => frame?.type === 'session/queue')).toMatchObject({
        type: 'session/queue', sessionId, items: [
          { id: queued.id, placement: 'queued' },
          { id: steering.id, placement: 'steering' },
          { id: context.id, placement: 'context' },
        ],
      })
      unowned.append('agent/inbox/spliced', { target: 'next-turn', start: 0, inserted: [queued] })
      expect(await nextFrame(stream)).toMatchObject({
        type: 'session/event', sessionId: unowned.id, event: { type: 'agent/inbox/spliced' },
      })
      expect(ctx.agents.get(unowned.id)).toBeUndefined()
      abort.abort()
      expect((await stream.next()).done).toBe(true)
    } finally {
      abort.abort()
      await ctx.fiber.dispose()
    }
  })

  it('edits, removes and steers exact pending identities while preserving other messages', async () => {
    const { ctx, inbox, api, sessionId, steer } = await harness()
    try {
      const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Queued input' }] })
      const steering = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Existing steer' }] })
      const context = createUserMessage({ source: { kind: 'plugin', plugin: 'synthetic' }, content: [{ type: 'text', text: 'Injected context' }] })
      inbox.append('next-turn', queued)
      inbox.append('next-step', steering)
      inbox.append('next-step', context)
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: queued.id, action: { kind: 'edit', content: [{ type: 'text', text: 'Edited input' }] },
      }))).result).toEqual({ ok: true, value: { accepted: true } })
      expect(inbox.nextTurn).toMatchObject([{ id: queued.id, content: [{ type: 'text', text: 'Edited input' }] }])
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: context.id, action: { kind: 'remove' },
      }))).result.ok).toBe(true)
      expect(inbox.nextStep).toEqual([steering])
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: queued.id, action: { kind: 'steer' },
      }))).result.ok).toBe(true)
      expect(inbox.nextTurn).toEqual([])
      expect(inbox.nextStep).toMatchObject([
        { id: steering.id }, { id: queued.id, content: [{ type: 'text', text: 'Edited input' }] },
      ])
      expect(steer).toHaveBeenCalledOnce()
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: context.id, action: { kind: 'remove' },
      }))).result).toMatchObject({ ok: false, error: { code: 'queue-item-not-found' } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('refuses steering after a turn ends or for input already assigned to the next step', async () => {
    const { ctx, agent, inbox, api, sessionId, steer } = await harness()
    try {
      const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Wait for a turn' }] })
      const step = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Already steering' }] })
      inbox.append('next-turn', queued)
      inbox.append('next-step', step)
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: step.id, action: { kind: 'steer' },
      }))).result).toMatchObject({ ok: false, error: { code: 'steer-unavailable' } })
      Object.assign(agent, { status: 'idle' })
      expect((await api.sessions.updateQueue(request({
        sessionId, itemId: queued.id, action: { kind: 'steer' },
      }))).result).toMatchObject({ ok: false, error: { code: 'steer-unavailable' } })
      expect(inbox.nextTurn).toEqual([queued])
      expect(inbox.nextStep).toEqual([step])
      expect(steer).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('rejects non-text edits and vanished sessions without changing the queue', async () => {
    const { ctx, inbox, api, sessionId } = await harness()
    try {
      const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep this input' }] })
      inbox.append('next-turn', queued)
      expect((await api.sessions.updateQueue(request({ sessionId, itemId: queued.id, action: {
        kind: 'edit', content: [{ type: 'image', attachment: {
          attachmentId: AttachmentId('image'), mediaType: 'image/png', bytes: 1, width: 1, height: 1,
        } }],
      } }))).result).toMatchObject({ ok: false, error: { details: { reason: 'QUEUE_EDIT_NON_TEXT' } } })
      expect((await api.sessions.updateQueue(request({
        sessionId: SessionId('not-attached'), itemId: MessageId('not-pending'), action: { kind: 'remove' },
      }))).result).toMatchObject({ ok: false, error: { code: 'queue-item-not-found' } })
      expect(inbox.nextTurn).toEqual([queued])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('cancels the live turn with keepInbox and reports a missing session clearly', async () => {
    const { ctx, inbox, api, sessionId, cancel } = await harness()
    try {
      const queued = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Keep after cancel' }] })
      inbox.append('next-turn', queued)
      expect((await api.sessions.cancel(request({ sessionId }))).result).toEqual({ ok: true, value: { accepted: true } })
      expect(cancel).toHaveBeenCalledExactlyOnceWith({ kind: 'user' }, { keepInbox: true })
      expect(inbox.nextTurn).toEqual([queued])
      expect((await api.sessions.cancel(request({ sessionId: SessionId('not-attached') }))).result)
        .toMatchObject({ ok: false, error: { code: 'session-not-found' } })
      expect(cancel).toHaveBeenCalledOnce()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
