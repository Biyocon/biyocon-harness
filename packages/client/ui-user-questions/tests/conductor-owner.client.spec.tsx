// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { PendingWait } from '@deepseek-ai/dsh-client-runtime/client'
import type { RpcReceipt } from '@deepseek-ai/dsh-api-remotes/client'
import { RpcId } from '@deepseek-ai/dsh-client-connection/client'
import type { ConductorOwnerQuestion, QuestionComposerProps } from '../src/client/contract/slots.ts'
import { conductorOwnerOf } from '../src/client/contract/slots.ts'
import { QuestionComposer } from '../src/client/QuestionComposer.tsx'
import { da, en } from '../src/client/locales.ts'

afterEach(cleanup)
const owner = (): ConductorOwnerQuestion => ({
  kind: 'conductor-owner', runId: 'CON-2026-0042', questionId: 'owner-1', revision: 1,
  gate: 'B', role: 'strategist', attempt: 2, reason: 'Two choices need owner input.',
  items: [{ id: 'name', prompt: 'Which identifier?', options: [] }, { id: 'mode', prompt: 'Which mode?', options: ['local', 'remote'] }],
})
const proposal = {
  before: { allowedPaths: ['old.md'], excludedPaths: [], qualityCommandIds: ['old-check'] },
  after: { allowedPaths: ['new.md'], excludedPaths: ['private'], qualityCommandIds: [] }, hash: 'proposal-sha',
}
const kit = { t: (key: string) => en[key as keyof typeof en] ?? key } as QuestionComposerProps
function mount(intent = owner(), respond = vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: true })), language = en) {
  const carrier = new PendingWait('question', RpcId('owner-request'), 'session-1' as never,
    { questions: [{ id: intent.questionId, question: intent.reason, intent }] }, respond)
  render(<QuestionComposer {...kit} t={key => language[key as keyof typeof language] ?? key} matched={carrier} interactions={[carrier]} />)
  return respond
}
function fill() {
  fireEvent.change(screen.getByRole('textbox', { name: /Which identifier/ }), { target: { value: '  canonical  ' } })
  fireEvent.change(screen.getByRole('combobox', { name: /Which mode/ }), { target: { value: 'local' } })
}
function result(action: 'approve' | 'reject' | 'answer_continue', amend = false) {
  return { type: 'client-response', rpcId: RpcId('owner-request'), result: { ok: true, value: {
    sessionId: 'session-1', answer: { answers: [], conductor: { questionId: 'owner-1', revision: 1, action,
      answers: action === 'reject' ? [] : [{ itemId: 'name', text: 'canonical' }, { itemId: 'mode', text: 'local', optionId: 'local' }],
      ...(amend && action !== 'reject' ? { proposalHash: 'proposal-sha' } : {}),
    } },
  } } }
}

describe('Conductor owner card', () => {
  it('selects typed Conductor intents only', () => {
    expect(conductorOwnerOf([])).toBeUndefined()
    expect(conductorOwnerOf([{ id: 'q', question: 'plain' }])).toBeUndefined()
    expect(conductorOwnerOf([{ id: 'q', question: 'plain', intent: { kind: 'plan-review', approve: 'yes' } }])).toBeUndefined()
  })
  it('fails closed for malformed known intents instead of exposing generic skip controls', () => {
    const question = { id: 'owner-1', question: 'Owner input', intent: owner() }
    expect(conductorOwnerOf([question])).toEqual(owner())
    for (const questions of [
      [question, question], [{ ...question, id: 'wrong' }], [{ ...question, multiSelect: true }],
      [{ ...question, multiSelect: false }], [{ ...question, options: [] }],
      [{ ...question, options: [{ label: 'skip' }] }],
    ]) expect(() => conductorOwnerOf(questions)).toThrow('requires one exact question')
  })
  it('shows exact provenance and waiting state, without generic skip, dismiss or plan review', () => {
    const respond = mount()
    expect(document.querySelector('[data-conductor-owner-question="owner-1"]')).toBeTruthy()
    expect(screen.getByText('CON-2026-0042')).toBeTruthy()
    expect(screen.getByText('Gate B')).toBeTruthy()
    expect(screen.getByText('Strategist · Attempt 2')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Waiting for owner')
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: /skip|dismiss|Chat about/i })).toBeNull()
    expect(screen.queryByText('Plan review')).toBeNull()
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })
    expect(respond).not.toHaveBeenCalled()
  })
  it('requires every answer and a non-default option, then sends machine identities', () => {
    const respond = mount()
    const submit = screen.getByRole('button', { name: 'Answer and continue' })
    expect(submit.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('combobox').querySelector('option:checked')?.getAttribute('value')).toBe('')
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '   ' } })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'canonical' } })
    expect(submit.hasAttribute('disabled')).toBe(true)
    fill()
    expect(submit.hasAttribute('disabled')).toBe(false)
    fireEvent.click(submit)
    expect(respond).toHaveBeenCalledWith(result('answer_continue'))
    expect(submit.hasAttribute('disabled')).toBe(true)
    fireEvent.click(submit)
    expect(respond).toHaveBeenCalledTimes(1)
  })
  it('rejects without requiring or sending draft answers', () => {
    const respond = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(respond).toHaveBeenCalledWith(result('reject'))
  })
  it('previews both complete mandates and requires an explicit amendment confirmation', () => {
    const respond = mount({ ...owner(), proposal })
    for (const text of ['old.md', 'new.md', 'private', 'old-check']) expect(screen.getByText(text)).toBeTruthy()
    expect(screen.getAllByText('None')).toHaveLength(2)
    fill()
    const approve = screen.getByRole('button', { name: 'Approve' })
    expect(approve.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'Answer and continue' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(approve)
    expect(respond).toHaveBeenCalledWith(result('approve', true))
  })
  it('allows answer_continue to confirm an amendment without deriving authority from its label', () => {
    const respond = mount({ ...owner(), proposal }, undefined, da)
    fill()
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Svar og fortsæt' }))
    expect(respond).toHaveBeenCalledWith(result('answer_continue', true))
    expect(screen.getByRole('button', { name: 'Godkend' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Afvis' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('Venter på ejeren')
  })
  it('re-arms after a rejected receipt without treating submission as accepted', async () => {
    const respond = mount(owner(), vi.fn(() => Promise.resolve<RpcReceipt>({ accepted: false, reason: 'not-pending' })))
    fill()
    fireEvent.click(screen.getByRole('button', { name: 'Answer and continue' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'question response rejected: not-pending')
    expect(screen.getByRole('button', { name: 'Answer and continue' }).hasAttribute('disabled')).toBe(false)
    expect(screen.getByRole('status').textContent).toBe('Waiting for owner')
    expect(respond).toHaveBeenCalledTimes(1)
  })
  it('reports non-Error transport failures without granting an acknowledgement', async () => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- exercise an untyped transport rejection.
    mount(owner(), vi.fn(() => Promise.reject('offline')))
    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    expect(await screen.findByText('offline')).toBeTruthy()
  })
  it('resumes a saved answer explicitly without editing it or granting another amendment', () => {
    const respond = mount({ ...owner(), mode: 'continuation', revision: 2, proposal })
    expect(screen.getByRole('status').textContent).toBe('Answer accepted')
    expect(screen.getByText('Which identifier?')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull()
    const button = screen.getByRole('button', { name: 'Answer and continue' })
    expect(button.hasAttribute('disabled')).toBe(false)
    fireEvent.click(button)
    const expected = result('answer_continue')
    expected.result.value.answer.conductor.revision = 2
    expected.result.value.answer.conductor.answers = []
    expect(respond).toHaveBeenCalledWith(expected)
  })
  it('supports proposal-only approval with no required clarification items', () => {
    const respond = mount({ ...owner(), items: [], proposal })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    const expected = result('approve', true)
    expected.result.value.answer.conductor.answers = []
    expect(respond).toHaveBeenCalledWith(expected)
  })
})
