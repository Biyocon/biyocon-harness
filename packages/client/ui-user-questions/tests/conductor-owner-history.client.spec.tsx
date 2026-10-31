// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatSnapshot, ConversationEventInput, ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import { chatViewDefinition } from '@deepseek-ai/dsh-client-ui-conversation/src/client/conversation-nodes/chat-snapshot-builder.ts'
import { conductorOwnerHistoryDefinition as definition } from '../src/client/conductor-owner-history.ts'
import type { ComponentProps } from 'react'
import { ConductorOwnerReceipt } from '../src/client/ConductorOwnerReceipt.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)
const question = { id: 'q1', runId: 'CON-2026-0001', stage: 'strategist', attempt: 2, reason: 'Choose the scope.',
  items: [{ id: 'scope', prompt: 'Which scope?', options: [] }, { id: 'policy', prompt: 'Which policy?', options: [] }] }
function entry(seq: number, type: string, interaction: unknown): ConversationEventInput {
  return { event: { seq, time: seq, type, data: { runId: 'CON-2026-0001', interaction } } as ConversationEventInput['event'], view: undefined }
}
const created = entry(1, 'conductor/owner-question-created', { kind: 'question', question })
const answered = entry(2, 'conductor/owner-response-recorded', { kind: 'answer', revision: 2, questionId: 'q1', action: 'answer_continue', answers: [{ itemId: 'scope', text: 'src' }] })
const rejected = entry(3, 'conductor/owner-terminal-rejection', { kind: 'rejected', revision: 2, questionId: 'q1' })
const acknowledged: ConversationEventInput = { event: { seq: 4, time: 4,
  type: 'conductor/owner-response-acknowledged', data: { runId: 'CON-2026-0001', questionId: 'q1', revision: 2, status: 'accepted' },
} as ConversationEventInput['event'], view: undefined }
const rejectedAck: ConversationEventInput = { ...acknowledged,
  event: { ...acknowledged.event, data: { ...acknowledged.event.data, status: 'rejected' } } as never,
}
function assembler() {
  return new ConversationNodeAssembler({ entries: () => [definition] as ConversationNodeDefinition[], fallbackEntry: () => undefined },
    { entries: () => [chatViewDefinition] })
}
function nodes(instance: ReturnType<typeof assembler>) {
  instance.flush()
  return [...(instance.snapshot('chat') as ChatSnapshot).nodes.values()]
}
function show(entries: ConversationEventInput[]) {
  const value = assembler()
  value.replaceWindow(entries, false)
  const node = nodes(value)[0]!
  const props = { node, t: (key: string) => en[key as keyof typeof en] ?? key,
    useSession: (select: (snapshot: unknown) => unknown) => select({ openState: 'open', pending: [] }) } as ComponentProps<typeof ConductorOwnerReceipt>
  render(<ConductorOwnerReceipt {...props} />)
  return node
}

describe('durable Conductor owner receipts', () => {
  it('restores the exact pending question from a fresh history window', () => {
    const node = show([created])
    expect(node.data).toMatchObject({ questionId: 'q1', owner: { runId: 'CON-2026-0001', gate: 'B', role: 'strategist', attempt: 2 }, status: 'waiting' })
    expect(screen.getByRole('status').textContent).toBe('Waiting for owner')
    expect(screen.getByText('Which scope?')).toBeTruthy()
    expect(document.querySelector('[data-conductor-owner-receipt="q1"]')).toBeTruthy()
  })
  it('restores an accepted receipt and its answers after a browser reload', () => {
    show([created, answered, acknowledged])
    expect(screen.getByRole('status').textContent).toBe('Answer accepted')
    expect(screen.getByText('src')).toBeTruthy()
    expect(screen.getByText('Which policy?')).toBeTruthy()
  })
  it('restores a rejection without granting actions', () => {
    show([created, rejected, rejectedAck])
    expect(screen.getByRole('status').textContent).toBe('Rejected by owner')
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('keeps streamed response facts waiting until their durable acknowledgement', () => {
    const node = show([created, answered])
    expect(node.data).toMatchObject({ status: 'waiting', answers: [] })
    expect(screen.getByRole('status').textContent).toBe('Waiting for owner')
    expect(screen.queryByText('src')).toBeNull()
    cleanup()
    show([created, rejected])
    expect(screen.getByRole('status').textContent).toBe('Waiting for owner')
  })
  it('refuses acknowledgement without its exact recorded response', () => {
    for (const patch of [{ runId: 'CON-2026-0002' }, { revision: 3 }, { status: 'rejected' }]) {
      const value = assembler()
      const bad = { ...acknowledged, event: { ...acknowledged.event,
        data: { ...acknowledged.event.data, ...patch } } } as ConversationEventInput
      expect(() => value.replaceWindow([created, answered, bad], false)).toThrow('contradicts its recorded response')
    }
    expect(() => assembler().replaceWindow([created, acknowledged], false)).toThrow('contradicts its recorded response')
  })
  it('keeps separate exact question ids and folds live append like replay', () => {
    const value = assembler()
    const q2 = entry(5, 'conductor/owner-question-created', { kind: 'question', question: { ...question, id: 'q2', attempt: 3 } })
    value.replaceWindow([created], false)
    value.append(answered)
    value.append(acknowledged)
    value.append(q2)
    expect(nodes(value).map(node => node.data)).toMatchObject([{ questionId: 'q1', status: 'accepted' }, { questionId: 'q2', status: 'waiting' }])
    const replay = assembler()
    replay.replaceWindow([created, answered, acknowledged, q2], false)
    expect(nodes(replay)).toEqual(nodes(value))
  })
  it('keeps update-only history pending until an earlier page supplies its question', () => {
    const value = assembler()
    value.replaceWindow([answered, acknowledged], true)
    expect(nodes(value)).toEqual([])
    value.prepend([created], false)
    expect(nodes(value)[0]?.data).toMatchObject({ status: 'accepted', questionId: 'q1' })
  })
  it('preserves interface fallbacks without inferring provenance from text', () => {
    const empty = { key: 'q1', id: 'q1', state: undefined, start: undefined } as unknown as Parameters<typeof definition.start>[0]
    expect(definition.buildViewNode!(empty)).toBeNull()
    expect(definition.match(entry(9, 'user/message', { text: 'conductor question' }).event)).toBeNull()
    const start = { event: created.event, location: { kind: 'unresolved' } } as never
    const state = definition.start(empty, start, {} as never)
    expect(definition.update({ ...empty, state }, start)).toBe(state)
    expect(definition.buildViewNode!({ ...empty, state })).toMatchObject({ location: { kind: 'unresolved' } })
    expect(() => definition.start(empty, { event: answered.event } as never, {} as never)).toThrow('requires a question-created')
    const invalid = entry(1, 'conductor/owner-question-created', { kind: 'question', question: { ...question, stage: 'intake' } })
    expect(() => definition.start(empty, { event: invalid.event } as never, {} as never)).toThrow('requires a gated specialist')
  })
})
