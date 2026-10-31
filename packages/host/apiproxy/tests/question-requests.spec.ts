import { describe, expect, it, vi } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest, ConductorOwnerIntent } from '@deepseek-ai/dsh-user-questions'
import { QuestionRequests } from '../src/question-requests.ts'
import type { MuxFrame } from '../src/api/events.ts'
import { RpcId } from '../src/api/rpc.ts'
import type { ClientResponse, RpcRequest } from '../src/api/rpc.ts'

type Requested = RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>
const owner = SessionId('question-owner')
const agent = { id: owner } as Agent
const generic: AskUserQuestionItem = { id: 'q', question: 'Which evidence?', options: [{ label: 'Docs' }, { label: 'Code' }] }
const intent: ConductorOwnerIntent = { kind: 'conductor-owner', runId: 'CON-2026-0037', questionId: 'owner-q',
  revision: 1, gate: 'B', role: 'strategist', attempt: 2, reason: 'Which source?', items: [{ id: 'source', prompt: 'Which source?', options: [] }] }
const conductorAnswer = { questionId: 'owner-q', revision: 1, action: 'answer_continue' as const,
  answers: [{ itemId: 'source', text: 'Use docs.' }] }

function harness() {
  const requested: Requested[] = []
  const resolved: Extract<MuxFrame, { type: 'question/resolved' }>[] = []
  const requests = new QuestionRequests(request => requested.push(request), result => resolved.push(result))
  const ask = (questions = [generic], fields: Omit<AskUserQuestionRequest, 'questions' | 'agent'> = {}) => {
    const pending = requests.ask({ agent, questions, ...fields })
    return { pending, frame: requested.at(-1)! }
  }
  return { requests, requested, resolved, ask }
}

function response(frame: Requested, answer: unknown, sessionId = owner): ClientResponse {
  return { type: 'client-response', rpcId: frame.rpcId, result: { ok: true, value: { sessionId, answer } } }
}

const genericAnswer = (selected: string[] = ['Docs']): AskUserQuestionAnswer => ({ answers: [{ id: 'q', selected }] })

describe('question request ownership and replay', () => {
  it('requires an owner and preserves exact stable frames through browser reconnection', async () => {
    const h = harness()
    h.requests.dispose()
    await expect(h.requests.ask({ questions: [generic] })).rejects.toMatchObject({ code: 'ASK_MISSING_AGENT' })
    expect(h.requests.frames()).toEqual([])
    const first = h.ask()
    const second = h.ask([{ id: 'other', question: 'Other?' }])
    expect(h.requests.frames()).toEqual(h.requested)
    expect(first.frame.rpcId).not.toBe(second.frame.rpcId)
    expect(first.frame.payload).toEqual({ type: 'question/requested', sessionId: owner, questions: [generic] })
    expect(await h.requests.respond(response(first.frame, genericAnswer()))).toEqual({ accepted: true })
    await expect(first.pending).resolves.toEqual(genericAnswer())
    expect(h.requests.frames()).toEqual([second.frame])
    expect(await h.requests.respond(response(second.frame, { answers: [{ id: 'other', selected: [], custom: 'A detail' }] })))
      .toEqual({ accepted: true })
    await second.pending
    expect(h.requests.frames()).toEqual([])
    expect(h.resolved.map(frame => [frame.questionRpcId, frame.outcome])).toEqual([
      [first.frame.rpcId, 'answered'], [second.frame.rpcId, 'answered'],
    ])
    expect(await h.requests.respond(response(first.frame, genericAnswer()))).toEqual({ accepted: false, reason: 'not-pending' })
    expect(await h.requests.respond({ ...response(first.frame, genericAnswer()), rpcId: RpcId('unknown') }))
      .toEqual({ accepted: false, reason: 'not-pending' })
  })

  it('unregisters abort listeners and rejects every pending consumer on host disposal', async () => {
    const h = harness()
    const abort = new AbortController()
    const first = h.ask([generic], { signal: abort.signal })
    const second = h.ask()
    const rejected = Promise.all([
      expect(first.pending).rejects.toMatchObject({ code: 'ASK_ABORTED' }),
      expect(second.pending).rejects.toMatchObject({ code: 'ASK_ABORTED' }),
    ])
    h.requests.dispose()
    await rejected
    expect(h.requests.frames()).toEqual([])
    expect(h.resolved).toHaveLength(2)
    abort.abort()
    expect(h.resolved).toHaveLength(2)
    h.requests.dispose()
  })

  it('withdraws only the exact aborted request', async () => {
    const h = harness()
    const abort = new AbortController()
    const first = h.ask([generic], { signal: abort.signal })
    const second = h.ask()
    const rejection = expect(first.pending).rejects.toMatchObject({ code: 'ASK_ABORTED' })
    abort.abort()
    await rejection
    expect(h.requests.frames()).toEqual([second.frame])
    expect(await h.requests.respond(response(second.frame, genericAnswer()))).toEqual({ accepted: true })
    await second.pending
  })
})

describe('question response validation and canonical encoding', () => {
  it('rejects malformed, foreign and incompatible generic answers without settling', async () => {
    const h = harness()
    const pending = h.ask()
    expect(await h.requests.respond(response(pending.frame, genericAnswer(), SessionId('foreign'))))
      .toEqual({ accepted: false, reason: 'bad-response' })
    for (const answer of [null, {}, { answers: [] }, { answers: [{ id: 'foreign', selected: [] }] },
      { answers: [{ id: 'q', selected: ['Docs', 'Docs'] }] }, { answers: [{ id: 'q', selected: [], custom: '   ' }] },
      { answers: [{ id: 'q', selected: ['Docs'], custom: 'Other' }] }, { answers: [{ id: 'q', selected: ['Docs', 'Code'] }] },
      { answers: [{ id: 'q', selected: ['forged'] }] }, { ...genericAnswer(), conductor: conductorAnswer }]) {
      expect(await h.requests.respond(response(pending.frame, answer))).toEqual({ accepted: false, reason: 'bad-response' })
    }
    expect(await h.requests.respond({ type: 'client-response', rpcId: pending.frame.rpcId,
      result: { ok: false, error: { code: 'internal', message: 'Foreign error', details: {} } } })).toEqual({ accepted: false, reason: 'bad-response' })
    expect(h.requests.frames()).toEqual([pending.frame])
    expect(h.resolved).toEqual([])
    expect(await h.requests.respond(response(pending.frame, genericAnswer()))).toEqual({ accepted: true })
    await pending.pending
  })

  it('keeps multi-select, free-text and plan-review generic encoding unchanged', async () => {
    const h = harness()
    const questions: AskUserQuestionItem[] = [{ ...generic, multiSelect: true }, { id: 'text', question: 'Details?' },
      { id: 'plan', question: 'Approve?', detail: '# Plan', options: [{ label: 'Approve' }], intent: { kind: 'plan-review', approve: 'Approve' } }]
    const pending = h.ask(questions)
    const answer: AskUserQuestionAnswer = { answers: [
      { id: 'q', selected: ['Docs', 'Code'], custom: 'And the changelog.' },
      { id: 'text', selected: [], custom: 'Use direct evidence.' }, { id: 'plan', selected: ['Approve'] },
    ] }
    expect(await h.requests.respond(response(pending.frame, answer))).toEqual({ accepted: true })
    await expect(pending.pending).resolves.toEqual(answer)
  })

  it('binds Conductor actions to the exact question and revision without deriving authority from labels', async () => {
    const h = harness()
    const pending = h.ask([{ id: intent.questionId, question: intent.reason, intent }])
    for (const answer of [{ answers: [] }, { ...genericAnswer(), conductor: conductorAnswer },
      { answers: [], conductor: { ...conductorAnswer, questionId: 'foreign' } },
      { answers: [], conductor: { ...conductorAnswer, revision: 0 } },
      { answers: [], conductor: { ...conductorAnswer, action: 'Godkend' } }]) {
      expect(await h.requests.respond(response(pending.frame, answer))).toEqual({ accepted: false, reason: 'bad-response' })
    }
    const normalized = { answers: [], conductor: { ...conductorAnswer,
      answers: [{ itemId: 'source', text: 'docs', optionId: 'docs' }], proposalHash: 'a'.repeat(64) } }
    expect(await h.requests.respond(response(pending.frame, normalized))).toEqual({ accepted: true })
    await expect(pending.pending).resolves.toEqual(normalized)
    const next = h.ask([{ id: intent.questionId, question: intent.reason, intent }])
    const omitted = { answers: [], conductor: conductorAnswer }
    expect(await h.requests.respond(response(next.frame, omitted))).toEqual({ accepted: true })
    await expect(next.pending).resolves.toEqual(omitted)
    expect((await next.pending).conductor?.answers[0]).not.toHaveProperty('optionId')
    expect((await next.pending).conductor).not.toHaveProperty('proposalHash')
  })

  it('cancels only through an explicit cancellation response', async () => {
    const h = harness()
    const pending = h.ask()
    const rejected = expect(pending.pending).rejects.toMatchObject({ code: 'ASK_CANCELLED' })
    expect(await h.requests.respond({ type: 'client-response', rpcId: pending.frame.rpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'Dismissed', details: {} } } })).toEqual({ accepted: true })
    await rejected
    expect(h.resolved[0]?.outcome).toBe('cancelled')
    expect(h.requests.frames()).toEqual([])
  })
})

describe('durable question acceptance', () => {
  it('retains each request callback privately and rejects wrong-session or wrong-revision callback selection', async () => {
    const h = harness()
    const firstAccept = vi.fn(() => Promise.resolve())
    const secondAccept = vi.fn(() => Promise.resolve())
    const request: AskUserQuestionRequest = { agent,
      questions: [{ id: intent.questionId, question: intent.reason, intent }], accept: firstAccept }
    const first = h.requests.ask(request)
    request.accept = secondAccept
    const firstFrame = h.requested[0]!
    const secondIntent = { ...intent, revision: 2 }
    const second = h.ask([{ id: secondIntent.questionId, question: secondIntent.reason, intent: secondIntent }], { accept: secondAccept })
    expect(await h.requests.respond(response(firstFrame, { answers: [], conductor: { ...conductorAnswer, revision: 2 } })))
      .toEqual({ accepted: false, reason: 'bad-response' })
    expect(firstAccept).not.toHaveBeenCalled()
    expect(secondAccept).not.toHaveBeenCalled()
    expect(await h.requests.respond(response(firstFrame, { answers: [], conductor: conductorAnswer }))).toEqual({ accepted: true })
    await first
    expect(firstAccept).toHaveBeenCalledExactlyOnceWith({ answers: [], conductor: conductorAnswer })
    expect(secondAccept).not.toHaveBeenCalled()
    const answer = { answers: [], conductor: { ...conductorAnswer, revision: 2 } }
    expect(await h.requests.respond(response(second.frame, answer))).toEqual({ accepted: true })
    await second.pending
    expect(secondAccept).toHaveBeenCalledExactlyOnceWith(answer)
  })

  it('shares identical in-flight receipts and rejects conflicting submissions until durability succeeds', async () => {
    const h = harness()
    const commit = Promise.withResolvers<undefined>()
    const accept = vi.fn(() => commit.promise)
    const pending = h.ask([generic], { accept })
    const submitted = response(pending.frame, genericAnswer())
    const receipt = h.requests.respond(submitted)
    expect(h.requests.respond(submitted)).toBe(receipt)
    expect(await h.requests.respond(response(pending.frame, genericAnswer(['Code'])))).toEqual({ accepted: false, reason: 'bad-response' })
    expect(h.resolved).toEqual([])
    expect(h.requests.frames()).toEqual([pending.frame])
    expect(accept).toHaveBeenCalledTimes(1)
    commit.resolve(undefined)
    expect(await receipt).toEqual({ accepted: true })
    await pending.pending
    expect(h.requests.frames()).toEqual([])
    expect(h.resolved).toHaveLength(1)
  })

  it('preserves a rejected consumer answer for an explicit later retry, without automatic retries', async () => {
    const h = harness()
    let allowed = false
    const accept = vi.fn(() => { if (!allowed) throw new Error('Not committed'); return Promise.resolve() })
    const pending = h.ask([generic], { accept })
    expect(await h.requests.respond(response(pending.frame, genericAnswer()))).toEqual({ accepted: false, reason: 'bad-response' })
    expect(accept).toHaveBeenCalledTimes(1)
    expect(h.requests.frames()).toEqual([pending.frame])
    expect(h.resolved).toEqual([])
    allowed = true
    expect(await h.requests.respond(response(pending.frame, genericAnswer()))).toEqual({ accepted: true })
    await pending.pending
    expect(accept).toHaveBeenCalledTimes(2)
  })

  it.each(['abort', 'dispose', 'cancel'] as const)('withholds a late acceptance after %s without resurrecting the request', async (action) => {
    const h = harness()
    const commit = Promise.withResolvers<undefined>()
    const abort = new AbortController()
    const pending = h.ask([generic], { signal: abort.signal, accept: () => commit.promise })
    const rejection = expect(pending.pending).rejects.toBeInstanceOf(Error)
    const receipt = h.requests.respond(response(pending.frame, genericAnswer()))
    if (action === 'abort') abort.abort()
    else if (action === 'dispose') h.requests.dispose()
    else expect(await h.requests.respond({ type: 'client-response', rpcId: pending.frame.rpcId,
      result: { ok: false, error: { code: 'cancelled', message: 'Dismissed', details: {} } } })).toEqual({ accepted: true })
    commit.resolve(undefined)
    expect(await receipt).toEqual({ accepted: false, reason: 'not-pending' })
    await rejection
    expect(h.requests.frames()).toEqual([])
    expect(h.resolved).toHaveLength(1)
    expect(h.resolved[0]?.outcome).toBe('cancelled')
  })
})
