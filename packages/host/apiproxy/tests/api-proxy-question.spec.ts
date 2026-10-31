import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy, MuxFrame, RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

async function harness(): Promise<{ ctx: Context; api: ApiProxy }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  return {
    ctx,
    api: createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' }),
  }
}

function agent(ctx: Context): Agent {
  const session = ctx.sessions.create()
  const value = { id: session.id, session, status: 'idle', ctx } as Agent
  ctx.agents.register(value)
  return value
}

function openMux(api: ApiProxy, abort: AbortController): {
  envelopes: RpcRequest<MuxFrame>[]
  waitForQuestion(): Promise<RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>>
} {
  const envelopes: RpcRequest<MuxFrame>[] = []
  let resolveQuestion!: (value: RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>) => void
  const question = new Promise<RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>>((resolve) => {
    resolveQuestion = resolve
  })
  void (async () => {
    for await (const envelope of api.events.mux({ rpcId: RpcId('question-mux'), payload: {} }, abort.signal)) {
      envelopes.push(envelope)
      if (envelope.payload.type === 'question/requested') {
        resolveQuestion(envelope as RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>)
      }
    }
  })()
  return { envelopes, waitForQuestion: () => question }
}

function answer(
  envelope: RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>,
  selected: string[],
  custom?: string,
): Parameters<ApiProxy['respond']>[0] {
  return {
    type: 'client-response',
    rpcId: envelope.rpcId,
    result: {
      ok: true,
      value: {
        sessionId: envelope.payload.sessionId,
        answer: {
          answers: [{
            id: envelope.payload.questions[0]?.id,
            selected,
            ...custom === undefined ? {} : { custom },
          }],
        },
      },
    },
  }
}

describe('question response validation', () => {
  it('accepts selected options with custom text for multi-select questions', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{
        id: 'targets',
        question: 'Choose targets and add another',
        multiSelect: true,
        options: [{ label: 'Code' }, { label: 'Docs' }],
      }],
    })
    const envelope = await mux.waitForQuestion()

    expect(await api.respond(answer(envelope, ['Code', 'Docs'], 'Release notes')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'targets', selected: ['Code', 'Docs'], custom: 'Release notes' }],
    })
    expect(mux.envelopes.some(item => item.payload.type === 'question/resolved')).toBe(true)
    abort.abort()
  })

  it('keeps selected options and custom text mutually exclusive for single-select questions', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const asked = ctx.userQuestions.ask({
      agent: agent(ctx),
      questions: [{
        id: 'target',
        question: 'Choose one target',
        options: [{ label: 'Code' }, { label: 'Docs' }],
      }],
    })
    const envelope = await mux.waitForQuestion()

    expect(await api.respond(answer(envelope, ['Code'], 'Release notes')))
      .toEqual({ accepted: false, reason: 'bad-response' })
    expect(await api.respond(answer(envelope, [], 'Release notes')))
      .toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({
      answers: [{ id: 'target', selected: [], custom: 'Release notes' }],
    })
    abort.abort()
  })
})


describe('durable Conductor answer transport', () => {
  it('preserves stable option IDs and the exact proposal hash through wire decoding', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const conductor = { questionId: 'owner-proposal', revision: 1, action: 'approve' as const,
      answers: [{ itemId: 'format', text: 'markdown', optionId: 'markdown' }], proposalHash: 'a'.repeat(64) }
    const asked = ctx.userQuestions.ask({ agent: agent(ctx),
      questions: [{ id: 'owner-proposal', question: 'Choose format.', intent: { kind: 'conductor-owner', runId: 'CON-2026-0037',
        questionId: 'owner-proposal', revision: 1, gate: 'B', role: 'strategist', attempt: 1, reason: 'Choose format.',
        items: [{ id: 'format', prompt: 'Choose format.', options: ['markdown'] }] } }],
      accept: (value) => { expect(value.conductor).toEqual(conductor); return Promise.resolve() },
    })
    const envelope = await mux.waitForQuestion()
    expect(await api.respond({ type: 'client-response', rpcId: envelope.rpcId, result: { ok: true,
      value: { sessionId: envelope.payload.sessionId, answer: { answers: [], conductor } } } })).toEqual({ accepted: true })
    await expect(asked).resolves.toEqual({ answers: [], conductor })
    abort.abort()
  })

  it('preserves typed machine actions and waits for durable acceptance before acknowledging', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    const commit = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const asked = ctx.userQuestions.ask({ agent: agent(ctx), questions: [{ id: 'owner-q', question: 'Which source?',
      intent: { kind: 'conductor-owner', runId: 'CON-2026-0037', questionId: 'owner-q', revision: 1,
        gate: 'B', role: 'strategist', attempt: 2, reason: 'Which source?', items: [{ id: 'source', prompt: 'Which source?', options: [] }] } }],
    accept: async () => { entered.resolve(undefined); await commit.promise },
    })
    const envelope = await mux.waitForQuestion()
    const response = { type: 'client-response' as const, rpcId: envelope.rpcId, result: { ok: true as const,
      value: { sessionId: envelope.payload.sessionId, answer: { answers: [], conductor: {
        questionId: 'owner-q', revision: 1, action: 'answer_continue' as const, answers: [{ itemId: 'source', text: 'Use docs.' }],
      } } } } }
    const accepted = api.respond(response)
    await entered.promise
    expect(mux.envelopes.some(item => item.payload.type === 'question/resolved')).toBe(false)
    const duplicate = api.respond(response)
    expect(await api.respond({ ...response, result: { ok: true, value: { ...response.result.value,
      answer: { ...response.result.value.answer, conductor: { ...response.result.value.answer.conductor, action: 'reject' } } } } }))
      .toEqual({ accepted: false, reason: 'bad-response' })
    commit.resolve(undefined)
    expect(await accepted).toEqual({ accepted: true })
    expect(await duplicate).toEqual({ accepted: true })
    await expect(asked).resolves.toEqual(response.result.value.answer)
    abort.abort()
  })

  it('retains the pending card on malformed, stale or consumer-rejected answers', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const mux = openMux(api, abort)
    let allow = false
    const asked = ctx.userQuestions.ask({ agent: agent(ctx), questions: [{ id: 'owner-q', question: 'Which source?',
      intent: { kind: 'conductor-owner', runId: 'CON-2026-0037', questionId: 'owner-q', revision: 1,
        gate: 'A', role: 'detective', attempt: 1, reason: 'Which source?', items: [] } }],
    accept: () => allow ? Promise.resolve() : Promise.reject(new Error('Missing required answers')),
    })
    const envelope = await mux.waitForQuestion()
    const conductor = { questionId: 'owner-q', revision: 1, action: 'reject', answers: [] }
    const respond = (answerValue: unknown) => api.respond({ type: 'client-response', rpcId: envelope.rpcId,
      result: { ok: true, value: { sessionId: envelope.payload.sessionId, answer: answerValue } } })
    for (const answerValue of [{ answers: [] }, { answers: [], conductor: { ...conductor, revision: 0 } },
      { answers: [], conductor: { ...conductor, questionId: 'forged' } }, { answers: [], conductor: { ...conductor, action: 'Godkend' } },
      { answers: [{ id: 'owner-q', selected: [] }], conductor }, { answers: [], conductor }]) {
      expect(await respond(answerValue)).toEqual({ accepted: false, reason: 'bad-response' })
    }
    expect(mux.envelopes.some(item => item.payload.type === 'question/resolved')).toBe(false)
    allow = true
    expect(await respond({ answers: [], conductor })).toEqual({ accepted: true })
    await asked
    abort.abort()
  })

  it('does not resurrect a cancelled wait when durable consumer acceptance finishes later', async () => {
    const { ctx, api } = await harness()
    const abort = new AbortController()
    const ownerAbort = new AbortController()
    const mux = openMux(api, abort)
    const commit = Promise.withResolvers<undefined>()
    const entered = Promise.withResolvers<undefined>()
    const asked = ctx.userQuestions.ask({ agent: agent(ctx), signal: ownerAbort.signal,
      questions: [{ id: 'q', question: 'Q?' }], accept: async () => { entered.resolve(undefined); await commit.promise } })
    const rejection = expect(asked).rejects.toThrow('aborted')
    const envelope = await mux.waitForQuestion()
    const response = api.respond(answer(envelope, []))
    await entered.promise
    ownerAbort.abort()
    commit.resolve(undefined)
    expect(await response).toEqual({ accepted: false, reason: 'not-pending' })
    await rejection
    abort.abort()
  })
})
