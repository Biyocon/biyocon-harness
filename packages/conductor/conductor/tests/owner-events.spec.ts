import { describe, expect, it, vi } from 'vitest'
import { KNOWN_SESSION_EVENT_TYPES, Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, SessionConductorRunStore, applyScriptedOwnerAnswer, consumeOwnerContinuation,
  contentHash, createRun, ownerMandateHash, parkOwnerQuestion, recordGate, resumeRun } from '../src/index.ts'
import { decodeOwnerInteractionEvent, publishOwnerInteractions, replayOwnerInteractions } from '../src/owner-events.ts'
import { implementationAdmission } from './intake-fixtures.ts'

function stages(amend = false) {
  const initial = recordGate(createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: SessionId('owner-events-root'), admission: implementationAdmission(),
    objective: 'Assess evidence.', authority: { owner: 'owner' },
    ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: [] },
  }), { decision: 'escalate', basis: ['Naming needs owner input.'], evidenceReviewed: [], stateUpdate: 'Waiting.' })
  const question = parkOwnerQuestion(initial, 'naming-question', { kind: 'recoverable', cause: amend ? 'authority-amendment' : 'clarification', reason: 'Which name?' },
    { childId: SessionId('owner-events-child'), attempt: 1, report: {}, reportHash: contentHash('{}') },
    [{ id: 'name', prompt: 'Choose the name.', options: [] }],
    amend ? { allowedPaths: ['report.md'], excludedPaths: [], qualityCommandIds: [] } : undefined)
  const response = { source: 'scripted-test-provider' as const, rootSessionId: initial.ownerSessionId!,
    questionId: 'naming-question', expectedRevision: question.ownerRevision, action: 'answer_continue' as const,
    answers: [{ itemId: 'name', text: 'Use the documented name.' }],
    ...amend ? { proposalHash: ownerMandateHash({ allowedPaths: ['report.md'], excludedPaths: [], qualityCommandIds: [] }) } : {} }
  const answered = applyScriptedOwnerAnswer(question, response)
  const consumed = consumeOwnerContinuation(answered, response.questionId)
  const { proposalHash: _proposalHash, ...plainResponse } = response
  const rejected = applyScriptedOwnerAnswer(question, { ...plainResponse, action: 'reject', answers: [] })
  const binding = { runId: initial.runId, rootSessionId: initial.ownerSessionId!, questionId: response.questionId,
    revision: question.ownerRevision, transportId: 'transport-one' }
  return { initial, question, answered, consumed, rejected, binding }
}

describe('required owner interaction events', () => {
  it('restores owner facts recognized by the generated required-event vocabulary', () => {
    const { initial, consumed } = stages()
    const session = Session.create(initial.ownerSessionId!)
    publishOwnerInteractions(session, consumed)
    expect(Session.create(initial.ownerSessionId!, session.events).events.slice(0, session.events.length)).toEqual(session.events)
    expect(session.events.every(event => KNOWN_SESSION_EVENT_TYPES.has(event.type) && event.ignorable === undefined)).toBe(true)
    expect(KNOWN_SESSION_EVENT_TYPES.has('conductor/owner-future')).toBe(false)
  })

  it('reconciles a complete mandate amendment from a durable response without granting execution', () => {
    const { initial, answered, binding } = stages(true)
    const session = Session.create(initial.ownerSessionId!)
    publishOwnerInteractions(session, answered, binding)
    const recovered = replayOwnerInteractions(initial, session.events)
    expect(recovered).toEqual(answered)
    expect(recovered.executionAuthorization).toBeNull()
    expect(recovered.baseline).toBeNull()
  })
  it.each(['question', 'answered', 'consumed', 'rejected'] as const)('round-trips %s and repairs a checkpoint crash boundary without dispatch', async (key) => {
    const states = stages()
    const session = Session.create(states.initial.ownerSessionId!)
    const store = new SessionConductorRunStore(session, () => Promise.resolve())
    await store.save(states.initial)
    const append = session.append.bind(session)
    const interrupted = vi.spyOn(session, 'append').mockImplementation((...args) => {
      if (args[0] === 'conductor/checkpoint') throw new Error('Injected checkpoint interruption')
      return append(args[0], args[1] as never)
    })
    await expect(store.save(states[key], states.binding)).rejects.toThrow('Injected checkpoint interruption')
    interrupted.mockRestore()
    await expect(store.load(states.initial.runId)).resolves.toEqual(states[key])
    const facts = session.events.filter(event => event.type.startsWith('conductor/owner-'))
    expect(facts.length).toBe(states[key].ownerLedger.length)
    for (const event of facts) {
      expect(event).not.toHaveProperty('ignorable')
      expect(decodeOwnerInteractionEvent(event.type, event.data).runId).toBe(states.initial.runId)
    }
    await store.save(states[key], states.binding)
    expect(session.events.filter(event => event.type.startsWith('conductor/owner-'))).toHaveLength(facts.length)
    await expect(store.load(states.initial.runId)).resolves.toEqual(states[key])
  })

  it('rejects conflicting event data instead of silently accepting a prior receipt', () => {
    const { initial, question } = stages()
    const session = Session.create(initial.ownerSessionId!)
    publishOwnerInteractions(session, question)
    const altered = structuredClone(question)
    const entry = altered.ownerLedger[0]!
    if (entry.kind !== 'question') throw new Error('Expected question')
    entry.question.reason = 'Different reason.'
    expect(() =>{  publishOwnerInteractions(session, altered) }).toThrow('conflicts')
  })

  it('rejects malformed payloads, wrong event discriminants, run IDs and receipt transport bindings', () => {
    const { question, answered, binding } = stages()
    const data = { runId: question.runId, interaction: question.ownerLedger[0]! }
    const type = 'conductor/owner-question-created'
    for (const invalid of [null, [], {}, { ...data, runId: 1 }, { ...data, runId: 'bad' },
      { runId: question.runId }, { ...data, extra: true }]) {
      expect(() => decodeOwnerInteractionEvent(type, invalid)).toThrow('Invalid Conductor')
    }
    expect(() => decodeOwnerInteractionEvent('conductor/owner-response-recorded', data)).toThrow('type or run')
    expect(() => decodeOwnerInteractionEvent(type, { ...data, runId: 'CON-2026-0038' })).toThrow('type or run')
    expect(() => decodeOwnerInteractionEvent(type, { ...data, interaction: {} })).toThrow()
    const answer = { runId: answered.runId, interaction: answered.ownerLedger.at(-1)! }
    expect(decodeOwnerInteractionEvent('conductor/owner-response-recorded', { ...answer, transport: binding }).transport).toEqual(binding)
    for (const transport of [null, [], {}, { ...binding, runId: 'CON-2026-0038' }, { ...binding, questionId: 'other' },
      { ...binding, rootSessionId: '' }, { ...binding, revision: 0 }, { ...binding, transportId: '' }, { ...binding, extra: 1 }]) {
      expect(() => decodeOwnerInteractionEvent('conductor/owner-response-recorded', { ...answer, transport })).toThrow('transport')
    }
    expect(() => decodeOwnerInteractionEvent(type, { ...data, transport: binding })).toThrow('transport')
  })

  it('keeps unrelated events out of recovery and rejects altered causal evidence', () => {
    const { initial, question, answered, binding } = stages()
    const session = Session.create(initial.ownerSessionId!)
    session.append('turn/start', { turn: 1 })
    publishOwnerInteractions(session, question)
    const facts = session.events
    expect(replayOwnerInteractions(initial, facts)).toEqual(question)
    expect(() => replayOwnerInteractions(question, facts)).toThrow('revision mismatch')
    const changed = structuredClone(facts)
    const event = changed.find(event => event.type === 'conductor/owner-question-created')!
    if (event.type !== 'conductor/owner-question-created') throw new Error('Expected question fact')
    event.data.interaction.question.mandateHash = '0'.repeat(64)
    expect(() => replayOwnerInteractions(initial, changed)).toThrow('contradicts')
    const foreign = Session.create(initial.ownerSessionId!)
    publishOwnerInteractions(foreign, answered, { ...binding, rootSessionId: SessionId('foreign') })
    expect(() => replayOwnerInteractions(initial, foreign.events)).toThrow('another root')
    expect(replayOwnerInteractions({ ...initial, runId: ConductorRunId('CON-2026-0038') }, session.events).ownerRevision).toBe(0)
  })

  it('does not resume an ambiguously consumed dispatch through the ordinary model path', async () => {
    const { consumed } = stages()
    const store = { load: () => Promise.resolve(consumed), save: () => Promise.resolve(), delete: () => Promise.resolve() }
    await expect(resumeRun(store, consumed.runId))
      .rejects.toThrow('ambiguous consumed owner dispatch')
  })
})
