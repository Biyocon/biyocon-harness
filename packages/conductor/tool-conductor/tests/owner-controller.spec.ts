import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { admitIntake, captureIntakeMaterial, ConductorRunId, contentHash, createRun, parkOwnerQuestion,
  recordGate, SessionConductorRunStore } from '@deepseek-ai/dsh-conductor'
import type { ConductorRun } from '@deepseek-ai/dsh-conductor'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { AskUserQuestionRequest, UserQuestionProvider } from '@deepseek-ai/dsh-user-questions'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConductorOwnerController } from '../src/owner-controller.ts'
import { installModeRouting } from '../src/mode-routing.ts'

class HostContinuationModel extends LlmAdapter {
  calls = 0
  beforeCall: (() => Promise<void>) | undefined
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.calls += 1
    if (options.messages.at(-1)?.content.some(block => block.type === 'tool-result')) {
      yield { type: 'finish', reason: { kind: 'stop' } }
      return
    }
    await this.beforeCall?.()
    const block = { type: 'tool-call' as const, id: CallId('owner-continue'), name: 'conductor',
      arguments: JSON.stringify({ runId: 'CON-2026-0037' }) }
    yield { type: 'block-start', index: 0, blockType: 'tool-call' }
    yield { type: 'tool-call-delta', index: 0, id: block.id, name: block.name, argumentsDelta: block.arguments }
    yield { type: 'block-end', index: 0, block }
    yield { type: 'finish', reason: { kind: 'tool-calls' } }
  }
}

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(
  seed?: readonly SessionEvent[], productionQuestions = false, provider?: UserQuestionProvider,
  beforeCreate?: (ctx: Context, controller: ConductorOwnerController) => void,
) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const questionFiber = await ctx.plugin(UserQuestionService)
  if (provider !== undefined) ctx.userQuestions.registerProvider(provider)
  ctx.on('session/flush', () => {})
  const model = new HostContinuationModel()
  ctx.llm.registerAdapter(['owner-controller'], model)
  let controller!: ConductorOwnerController
  const ownerFiber = await ctx.plugin({ name: 'owner-controller-fixture', inject: ['agents', 'sessions'],
    apply: (ownerCtx) => { controller = new ConductorOwnerController(ownerCtx, productionQuestions) } })
  installModeRouting(ctx, controller)
  beforeCreate?.(ctx, controller)
  const { agent } = await ctx.agents.create({ sessionId: SessionId('controller-root'),
    agentOptions: { provider: 'owner-controller', model: 'test' }, ...seed === undefined ? {} : { seed } })
  const store = new SessionConductorRunStore(agent.session, async () => {
    if (!await ctx.sessions.flush(agent.session)) throw new Error('Fixture flush failed')
  })
  const material = captureIntakeMaterial('current-request', 'Assess the evidence.', { sessionId: agent.id, eventIndex: 0 })
  const initial = recordGate(createRun(ConductorRunId('CON-2026-0037'), {
    ownerSessionId: agent.id, ownerCapabilities: { allowedPaths: ['.'], excludedPaths: [], qualityCommandIds: [] },
    objective: 'Assess the evidence.', authority: { owner: 'owner' }, acceptanceCriteria: ['Assess cited evidence.'],
    admission: admitIntake({ purpose: 'analysis', entry: 'detective', deliverable: 'answer', rationale: 'New owner question.' }, [material]),
  }), { decision: 'escalate', basis: ['Which evidence?'], evidenceReviewed: [], stateUpdate: 'Await owner.' })
  const run = parkOwnerQuestion(initial, 'controller-question', { kind: 'recoverable', cause: 'clarification', reason: 'Which evidence?' },
    { childId: SessionId('controller-child'), attempt: 1, report: {}, reportHash: contentHash('{}') },
    [{ id: 'evidence', prompt: 'Which evidence?', options: [] }])
  if (seed === undefined) await store.save(run)
  let dispatches = 0
  let consumed: ConductorRun | undefined
  let afterConsumed: ((run: ConductorRun) => Promise<void>) | undefined
  ctx.tools.register(defineTool({ name: 'conductor', description: 'Continue exactly one stored run.',
    parameters: { runId: { type: 'string', required: true } },
    output: { schema: { type: 'null' }, render: () => [] },
    execute: async (args, exec) => {
      consumed = await controller.consume(agent, args.runId, exec.signal)
      if (consumed !== undefined) {
        dispatches += 1
        await afterConsumed?.(consumed)
      }
      return null
    },
  }))
  ctx.tools.register(defineTool({ name: 'read', description: 'Read.', parameters: {},
    output: { schema: { type: 'null' }, render: () => [] }, execute: () => Promise.resolve(null) }))
  const response = { source: 'scripted-test-provider' as const, rootSessionId: agent.id, questionId: 'controller-question',
    expectedRevision: run.ownerRevision, action: 'answer_continue' as const,
    answers: [{ itemId: 'evidence', text: 'Use the cited evidence only.' }] }
  return { ctx, agent, controller, ownerFiber, questionFiber, store, run, model, response,
    onConsumed: (handler: (run: ConductorRun) => Promise<void>) => { afterConsumed = handler },
    dispatches: () => dispatches, consumed: () => consumed }
}

describe('Conductor-owned host answer turns', () => {
  it.each(['checkpoint', 'receipt', 'cancel'] as const)('parks failed receipt recovery at the %s boundary without dispatch', async (boundary) => {
    const original = await setup()
    const binding = await original.controller.reconnect(original.agent, original.run.runId)
    const actualFlush = original.ctx.sessions.flush.bind(original.ctx.sessions)
    const failure = vi.spyOn(original.ctx.sessions, 'flush').mockImplementation(session =>
      session.events.some(event => event.type === 'conductor/owner-response-recorded') ? Promise.resolve(false) : actualFlush(session))
    await expect(original.controller.respond(original.agent, binding, original.response, new AbortController().signal)).rejects.toThrow()
    await original.agent.whenIdle()
    failure.mockRestore()
    const logged = Promise.withResolvers<undefined>()
    const recovered = await setup(original.agent.session.events, true, undefined, (ctx, controller) => {
      ctx.logger.exporter({ levels: { default: 3 }, export: () => { logged.resolve(undefined) } })
      if (boundary === 'cancel') {
        ctx.on('agent/inbox/inserted', ({ agent, message }) => {
          if (message.content.some(block => block.type === 'text' && block.text.startsWith('Recover the saved'))) controller.cancel(agent)
        })
      } else {
        const flush = ctx.sessions.flush.bind(ctx.sessions)
        vi.spyOn(ctx.sessions, 'flush').mockImplementation((session) => {
          const marked = session.events.some(event => event.type === 'conductor/owner-response-acknowledged')
          return (boundary === 'receipt' ? marked : !marked) ? Promise.resolve(false) : flush(session)
        })
      }
    })
    await logged.promise
    await recovered.agent.whenIdle()
    expect(recovered.dispatches()).toBe(0)
    expect(recovered.model.calls).toBe(0)
    expect(recovered.agent.session.events.some(event => event.type === 'conductor/owner-response-acknowledged'))
      .toBe(boundary === 'receipt')
  })

  it('offers a saved-answer recovery card and consumes its plan only after the exact owner gesture', async () => {
    const original = await setup()
    const binding = await original.controller.reconnect(original.agent, original.run.runId)
    const actual = original.ctx.sessions.flush.bind(original.ctx.sessions)
    const flush = vi.spyOn(original.ctx.sessions, 'flush').mockImplementation(session =>
      session.events.some(event => event.type === 'conductor/owner-response-recorded') ? Promise.resolve(false) : actual(session))
    await expect(original.controller.respond(original.agent, binding, original.response, new AbortController().signal)).rejects.toThrow()
    await original.agent.whenIdle()
    flush.mockRestore()
    const pending = Promise.withResolvers<AskUserQuestionRequest>()
    const replied = Promise.withResolvers<{ answers: [] }>()
    const h = await setup(original.agent.session.events, true, { ask: (request) => { pending.resolve(request); return replied.promise } })
    const request = await pending.promise
    expect(request.questions[0]?.intent).toMatchObject({ kind: 'conductor-owner', mode: 'continuation', questionId: 'controller-question', revision: 2 })
    expect(h.dispatches()).toBe(0)
    expect(h.model.calls).toBe(0)
    const conductor = { questionId: 'controller-question', revision: 2, action: 'answer_continue' as const, answers: [] }
    for (const answer of [{ answers: [] }, { answers: [{ id: 'forged', selected: [] }], conductor },
      { answers: [], conductor: { ...conductor, questionId: 'foreign' } }, { answers: [], conductor: { ...conductor, revision: 1 } },
      { answers: [], conductor: { ...conductor, action: 'reject' as const } }, { answers: [], conductor: { ...conductor, answers: [{ itemId: 'evidence', text: 'Changed answer' }] } },
      { answers: [], conductor: { ...conductor, proposalHash: 'forged' } }]) {
      await expect(request.accept?.(answer)).rejects.toThrow('exact unmodified owner gesture')
    }
    await request.accept?.({ answers: [], conductor })
    replied.resolve({ answers: [] })
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
    expect((await h.store.load(h.run.runId))?.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'answer', 'consumed'])
    await expect(request.accept?.({ answers: [], conductor })).rejects.toThrow('consumed transport binding')
    expect(h.dispatches()).toBe(1)
  })

  it.each(['answer_continue', 'reject'] as const)('recovers a saved %s receipt in a model-free turn without dispatching after restart', async (action) => {
    const original = await setup()
    const binding = await original.controller.reconnect(original.agent, original.run.runId)
    const response = { ...original.response, action, answers: action === 'reject' ? [] : original.response.answers }
    const actual = original.ctx.sessions.flush.bind(original.ctx.sessions)
    const flush = vi.spyOn(original.ctx.sessions, 'flush').mockImplementation(session =>
      session.events.some(event => event.type === 'conductor/owner-response-recorded' || event.type === 'conductor/owner-terminal-rejection')
        ? Promise.resolve(false) : actual(session))
    await expect(original.controller.respond(original.agent, binding, response, new AbortController().signal)).rejects.toThrow('reservation changed')
    await original.agent.whenIdle()
    flush.mockRestore()
    expect(original.agent.session.events.some(event => event.type === 'conductor/owner-response-acknowledged')).toBe(false)
    const recovered = await setup(original.agent.session.events, true)
    await recovered.agent.whenIdle()
    expect(recovered.agent.session.events.filter(event => event.type === 'conductor/owner-response-acknowledged')).toHaveLength(1)
    expect(recovered.model.calls).toBe(0)
    expect(recovered.dispatches()).toBe(0)
    expect((await recovered.store.load(recovered.run.runId))?.status).toBe(action === 'reject' ? 'aborted' : 'continuation_pending')
    const restarted = await setup(recovered.agent.session.events, true)
    await restarted.agent.whenIdle()
    expect(restarted.agent.session.events.filter(event => event.type === 'conductor/owner-response-acknowledged')).toHaveLength(1)
    expect(restarted.dispatches()).toBe(0)
  })

  it('reoffers the same durable question when its owner root is reconstructed and ignores other checkpoint revisions', async () => {
    const original = await setup()
    const unrelated = createRun(ConductorRunId('CON-2026-0038'), {
      admission: original.run.admission, objective: original.run.objective, authority: original.run.authority,
      ownerSessionId: original.agent.id, acceptanceCriteria: original.run.acceptanceCriteria,
    })
    await original.store.save(unrelated)
    await original.store.save(unrelated)
    original.agent.session.append('conductor/checkpoint', { runId: ConductorRunId('CON-2026-0039'), record: null })
    original.agent.session.append('session/title', { title: 'Pending owner question', source: { kind: 'user' }, messageSeqs: [] })
    const request = Promise.withResolvers<AskUserQuestionRequest>()
    const finished = Promise.withResolvers<{ answers: [] }>()
    const recovered = await setup(original.agent.session.events, true, {
      ask: (value) => { request.resolve(value); return finished.promise },
    })
    const question = await request.promise
    expect(question.questions[0]?.intent).toMatchObject({ questionId: 'controller-question', revision: 1 })
    await question.accept?.({ answers: [], conductor: { questionId: 'controller-question', revision: 1,
      action: 'reject', answers: [] } })
    finished.resolve({ answers: [] })
    expect((await recovered.store.load(recovered.run.runId))?.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'rejected'])
    expect(recovered.dispatches()).toBe(0)
    const child = await recovered.agent.ctx.agents.create({ sessionId: SessionId('ignored-production-child'), meta: { origin: 'subagent' } })
    expect(child.agent).toBeDefined()
  })

  it('stays parked when a production UI service is unavailable', async () => {
    const h = await setup(undefined, true)
    const logged = Promise.withResolvers<undefined>()
    const warning = h.ctx.logger.exporter({ levels: { default: 3 }, export: (message) => {
      if (message.args.map(String).join(' ').includes('no question UI provider')) logged.resolve(undefined)
    } })
    await h.questionFiber.dispose()
    h.controller.offer(h.agent, h.run.runId)
    await logged.promise
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
    expect(h.dispatches()).toBe(0)
    await warning()
  })

  it('answers through the production typed question service and its durable acceptance callback', async () => {
    const h = await setup(undefined, true)
    const pending = Promise.withResolvers<AskUserQuestionRequest>()
    const done = Promise.withResolvers<undefined>()
    h.ctx.userQuestions.registerProvider({
      ask: (request) => { pending.resolve(request); return done.promise.then(() => ({ answers: [] })) },
    })
    h.controller.offer(h.agent, h.run.runId)
    const request = await pending.promise
    expect(request.questions[0]?.intent).toMatchObject({ kind: 'conductor-owner', runId: h.run.runId,
      questionId: 'controller-question', revision: 1, gate: 'A', role: 'detective', attempt: 1 })
    await expect(request.accept?.({ answers: [], conductor: { questionId: 'controller-question', revision: 1,
      action: 'answer_continue', answers: [] } })).rejects.toThrow('every required item')
    await request.accept?.({ answers: [], conductor: { questionId: 'controller-question', revision: 1,
      action: 'answer_continue', answers: [{ itemId: 'evidence', text: 'Use the cited evidence only.' }] } })
    done.resolve(undefined)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
    expect(h.agent.session.events.some(event => event.type === 'conductor/owner-response-recorded')).toBe(true)
  })

  it('offers the next same-run question while the previous host still awaits the resumed turn', async () => {
    const h = await setup()
    const secondOffered = Promise.withResolvers<undefined>()
    const failed = Promise.withResolvers<Error>()
    const bothFinished = Promise.withResolvers<undefined>()
    let responses = 0
    let finished = 0
    h.ctx.on('tools/result', (_exec, result) => {
      if (result.isError) failed.resolve(new Error(JSON.stringify(result)))
    })
    h.onConsumed(async (run) => {
      if (h.dispatches() !== 1) return
      const escalated = recordGate(run, { decision: 'escalate', basis: ['A second question.'], evidenceReviewed: [], stateUpdate: 'Await owner.' })
      const again = parkOwnerQuestion(escalated, 'controller-question-2',
        { kind: 'recoverable', cause: 'clarification', reason: 'Which further evidence?' },
        { childId: SessionId('controller-child-2'), attempt: 2, report: {}, reportHash: contentHash('{}') },
        [{ id: 'evidence', prompt: 'Which further evidence?', options: [] }])
      await h.store.save(again)
      h.controller.offer(h.agent, run.runId)
    })
    h.ctx.provide('conductorOwnerHostTest', { kind: 'scripted-test-provider', settled: bothFinished.promise,
      interact: async (controller, agent, runId, signal) => {
        const binding = await controller.reconnect(agent, runId)
        if (++responses === 2) secondOffered.resolve(undefined)
        await controller.respond(agent, binding,
          { ...h.response, questionId: binding.questionId, expectedRevision: binding.revision }, signal)
        // The same provider behavior as the installed-preset scripted host.
        await agent.whenIdle()
        if (++finished === 2) bothFinished.resolve(undefined)
      } })
    h.controller.offer(h.agent, h.run.runId)
    const failure = await Promise.race([secondOffered.promise, failed.promise])
    expect(failure).toBeUndefined()
    await bothFinished.promise
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(2)
    expect((await h.store.load(h.run.runId))?.ownerLedger.map(entry => entry.kind))
      .toEqual(['question', 'answer', 'consumed', 'question', 'answer', 'consumed'])
  })

  it('denies unknown runs and non-owning live agents without reserving anything', async () => {
    const h = await setup()
    h.controller.cancel(h.agent)
    expect(await h.controller.consume(h.agent, h.run.runId, new AbortController().signal)).toBeUndefined()
    await expect(h.controller.reconnect(h.agent, ConductorRunId('CON-2026-0038'))).rejects.toThrow('missing')
    const { agent: child } = await h.agent.ctx.agents.create({ sessionId: SessionId('foreign-child'), meta: { origin: 'subagent' } })
    await expect(h.controller.reconnect(child, h.run.runId)).rejects.toThrow('exact live owning root')
    const detached = h.ctx.agentLoop.create(SessionId('unregistered-root'), {})
    await expect(h.controller.reconnect(detached, h.run.runId)).rejects.toThrow('missing')
    expect(h.model.calls).toBe(0)
  })

  it('keeps missing durability loud before reconnection or interaction', async () => {
    const h = await setup()
    const flush = vi.spyOn(h.ctx.sessions, 'flush').mockResolvedValue(false)
    await expect(h.controller.reconnect(h.agent, h.run.runId)).rejects.toThrow('not durably available')
    let complete!: () => void
    const logged = new Promise<void>((resolve) => { complete = resolve })
    const warnings: unknown[] = []
    const warning = h.ctx.logger.exporter({ levels: { default: 3 }, export: (message) => {
      warnings.push(...message.args.map(String)); complete()
    } })
    h.ctx.provide('conductorOwnerHostTest', { kind: 'scripted-test-provider', settled: Promise.resolve(),
      interact: () => { throw new Error('Must not offer an unflushed question') } })
    expect(h.ctx.get('conductorOwnerHostTest')).toBeDefined()
    h.controller.offer(h.agent, h.run.runId)
    await logged
    expect(warnings.join(' ')).toContain('could not be flushed before interaction')
    expect(h.model.calls).toBe(0)
    await warning()
    flush.mockRestore()
  })

  it('logs scripted provider failures without granting permission or dispatching', async () => {
    for (const failure of [new Error('Provider disconnected'), 'Provider disconnected']) {
      const h = await setup()
      let complete!: () => void
      const logged = new Promise<void>((resolve) => { complete = resolve })
      const warnings: unknown[] = []
      const warning = h.ctx.logger.exporter({ levels: { default: 3 }, export: (message) => {
        warnings.push(...message.args.map(String)); complete()
      } })
      h.ctx.provide('conductorOwnerHostTest', { kind: 'scripted-test-provider', settled: Promise.resolve(),
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- untyped providers may reject with a non-Error value.
        interact: () => Promise.reject(failure) })
      h.controller.offer(h.agent, h.run.runId)
      await logged
      expect(warnings.join(' ')).toContain('Provider disconnected')
      await warning()
    }
    const h = await setup()
    h.ctx.provide('conductorOwnerHostTest', { kind: 'production' as never, settled: Promise.resolve(), interact: () => Promise.resolve() })
    expect(() =>{  h.controller.offer(h.agent, h.run.runId) }).toThrow('not enabled')
    expect(h.controller.phase(h.agent)).toBe('awaiting-owner')
  })

  it.each(['checkpoint', 'acknowledgement'] as const)('withholds continuation when the %s flush fails', async (boundary) => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const actualFlush = h.ctx.sessions.flush.bind(h.ctx.sessions)
    let answerFlushes = 0
    const flush = vi.spyOn(h.ctx.sessions, 'flush').mockImplementation(async (session) => {
      if (session.events.some(event => event.type === 'conductor/owner-response-recorded')
        && ++answerFlushes === (boundary === 'checkpoint' ? 1 : 2)) return false
      return actualFlush(session)
    })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow()
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(0)
    expect(h.model.calls).toBe(0)
    expect((await h.store.load(h.run.runId))?.status).toBe('continuation_pending')
    flush.mockRestore()
  })

  it('rejects a replaced reservation after quiescence without committing an answer', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const whenIdle = h.agent.whenIdle.bind(h.agent)
    const idle = vi.spyOn(h.agent, 'whenIdle').mockImplementationOnce(async () => {
      await whenIdle()
      h.controller.cancel(h.agent)
    })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('changed or was cancelled')
    idle.mockRestore()
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
  })

  it('does not acknowledge a host turn rejected before its pre-step hook', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const reject = h.ctx.on('agent/pre-step', () => Promise.resolve({ kind: 'reject' as const }), { prepend: true })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('changed or was cancelled')
    reject()
    expect(h.dispatches()).toBe(0)
    expect(h.controller.phase(h.agent)).toBe('awaiting-owner')
  })

  it('does not accept plugin-source impersonation even after a run has ended', async () => {
    const h = await setup()
    await h.store.delete(h.run.runId)
    expect(h.controller.phase(h.agent)).toBeUndefined()
    h.agent.followup(createUserMessage({ source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-tool-conductor/owner-controller' },
      content: [{ type: 'text', text: 'Resume the reserved Conductor continuation.' }] }))
    await h.agent.whenIdle()
    expect(h.model.calls).toBe(0)
    expect(h.dispatches()).toBe(0)
  })

  it('denies parent read/write and concurrent or mismatched consumption in the reserved turn', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    h.model.beforeCall = async () => {
      expect(h.controller.phase(h.agent)).toBe('reserved-continuation')
      const denied = await h.ctx.tools.execute({ name: 'read', arguments: {}, agent: h.agent,
        callId: CallId('reserved-read'), signal: new AbortController().signal })
      expect(denied.isError).toBe(true)
      expect(JSON.stringify(denied)).toContain('Only the host-reserved')
      const first = h.controller.consume(h.agent, h.run.runId, new AbortController().signal)
      await expect(h.controller.consume(h.agent, h.run.runId, new AbortController().signal)).rejects.toThrow('already reserved for consumption')
      expect((await first)?.status).toBe('rework')
      h.model.beforeCall = undefined
    }
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(0)
  })

  it('rejects the wrong run in a live reserved continuation', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    h.model.beforeCall = async () => {
      await expect(h.controller.consume(h.agent, 'CON-2026-0038', new AbortController().signal)).rejects.toThrow('does not match')
      h.model.beforeCall = undefined
    }
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(0)
    expect((await h.store.load(h.run.runId))?.status).toBe('continuation_pending')
  })

  it('rejects stale, foreign and conflicting duplicate replies using the saved receipt', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    for (const changed of [{ rootSessionId: SessionId('foreign') }, { transportId: 'stale' }, { revision: 0 }]) {
      await expect(h.controller.respond(h.agent, { ...binding, ...changed }, h.response, new AbortController().signal)).rejects.toThrow('foreign or stale')
    }
    await expect(h.controller.respond(h.agent, binding, { ...h.response, answers: [{ itemId: 'evidence', text: 'A conflicting answer.' }] },
      new AbortController().signal)).rejects.toThrow()
    const flush = vi.spyOn(h.ctx.sessions, 'flush').mockResolvedValue(false)
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('saved receipt could not be flushed')
    flush.mockRestore()
    expect(h.dispatches()).toBe(1)
  })

  it('rejects a saved response event that contradicts the complete checkpoint', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    const seed = structuredClone(h.agent.session.events)
    const fact = seed.find(event => event.type === 'conductor/owner-response-recorded')!
    if (fact.type !== 'conductor/owner-response-recorded') throw new Error('Expected response')
    fact.data.interaction.answers[0]!.text = 'Tampered receipt.'
    const restarted = await setup(seed)
    await expect(restarted.controller.respond(restarted.agent, binding, restarted.response, new AbortController().signal))
      .rejects.toThrow('contradicts its authoritative ledger')
    expect(restarted.dispatches()).toBe(0)
  })

  it('withdraws a discarded opaque token before it can enter a host turn', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    h.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text.startsWith('Record owner reservation '))) h.agent.inbox.remove(message.id)
    })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('changed or was cancelled')
    await h.agent.whenIdle()
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
    expect(h.dispatches()).toBe(0)
  })

  it('does not acknowledge an empty intercepted host turn that saved no answer', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const intercept = h.ctx.on('agent/pre-step', () => Promise.resolve({ kind: 'enter' as const, messages: [] }), { prepend: true })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('not committed')
    intercept()
    expect(h.model.calls).toBe(0)
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
  })

  it('refuses a continuation whose checkpoint changed before its host hook', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    h.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text === 'Resume the reserved Conductor continuation.')) {
        void h.store.save(h.run)
      }
    })
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    expect(h.model.calls).toBe(0)
    expect(h.dispatches()).toBe(0)
    expect(h.agent.session.events.filter(event => event.type === 'turn/end').at(-1)?.data.reason.kind).not.toBe('completed')
  })

  it('refuses a changed continuation plan and cancels consumption at an await boundary', async () => {
    for (const mode of ['plan', 'cancel'] as const) {
      const h = await setup()
      const binding = await h.controller.reconnect(h.agent, h.run.runId)
      h.model.beforeCall = async () => {
        if (mode === 'plan') await h.store.save(h.run)
        const operation = h.controller.consume(h.agent, h.run.runId, new AbortController().signal)
        if (mode === 'cancel') h.controller.cancel(h.agent)
        await expect(operation).rejects.toThrow(mode === 'plan' ? 'no longer reserved' : 'changed or was cancelled')
        h.model.beforeCall = undefined
      }
      await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
      await h.agent.whenIdle()
      expect(h.dispatches()).toBe(0)
    }
  })

  it('permits one queued resume reservation when two host requests race after a durable answer', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const abort = new AbortController()
    h.ctx.on('session/flush', () => {
      if (h.agent.session.events.some(event => event.type === 'conductor/owner-response-recorded')) abort.abort()
    })
    await expect(h.controller.respond(h.agent, binding, h.response, abort.signal)).rejects.toThrow()
    await h.agent.whenIdle()
    const requests = await Promise.allSettled([h.controller.resumePending(h.agent, h.run.runId, new AbortController().signal),
      h.controller.resumePending(h.agent, h.run.runId, new AbortController().signal)])
    expect(requests.filter(result => result.status === 'fulfilled')).toHaveLength(1)
    expect(requests.filter(result => result.status === 'rejected')).toHaveLength(1)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
  })

  it('refuses another host turn while an answer reservation is live', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    let denied: Promise<void> | undefined
    h.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (message.content.some(block => block.type === 'text' && block.text.startsWith('Record owner reservation '))) {
        denied = expect(h.controller.resumePending(h.agent, h.run.runId, new AbortController().signal)).rejects.toThrow('already has a host turn')
      }
    })
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await denied
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
  })

  it('quiesces an in-flight response during controller disposal without scheduling continuation', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const actualIdle = h.agent.whenIdle.bind(h.agent)
    let disposal: Promise<void> | undefined
    const idle = vi.spyOn(h.agent, 'whenIdle').mockImplementationOnce(async () => {
      disposal = h.ownerFiber.dispose()
      await actualIdle()
    })
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow('exact live owning root')
    await disposal
    idle.mockRestore()
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
    expect(h.dispatches()).toBe(0)
  })

  it.each(['cancel', 'dispose'] as const)('settles a pending host question on %s while retaining the durable question', async (action) => {
    const h = await setup()
    const entered = Promise.withResolvers<undefined>()
    const finished = Promise.withResolvers<undefined>()
    h.ctx.provide('conductorOwnerHostTest', { kind: 'scripted-test-provider', settled: finished.promise,
      interact: (_controller, _agent, _runId, signal) => new Promise<void>((resolve) => {
        signal.addEventListener('abort', () => { finished.resolve(undefined); resolve() }, { once: true })
        entered.resolve(undefined)
      }) })
    h.controller.offer(h.agent, h.run.runId)
    await entered.promise
    expect(() =>{  h.controller.offer(h.agent, h.run.runId) }).toThrow('already has an owner interaction')
    if (action === 'cancel') h.controller.cancel(h.agent)
    else await h.ownerFiber.dispose()
    await finished.promise
    expect((await h.store.load(h.run.runId))?.status).toBe('awaiting_owner')
    expect(h.dispatches()).toBe(0)
    expect(h.model.calls).toBe(0)
  })
  it('flushes an answer in a model-free turn before its single constrained continuation', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const receipt = await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    expect(receipt.status).toBe('continuation_pending')
    expect(h.dispatches()).toBe(1)
    expect(h.consumed()?.executionAuthorization).toBeNull()
    const events = h.agent.session.events
    const turns = events.filter(event => event.type === 'turn/end')
    expect(turns[0]?.data.reason.kind).toBe('completed')
    const firstStep = events.findIndex(event => event.type === 'step/start')
    const answer = events.findIndex(event => event.type === 'conductor/owner-response-recorded')
    expect(answer).toBeGreaterThan(0)
    expect(firstStep).toBeGreaterThan(answer)
    const queued = events.filter(event => event.type === 'agent/inbox/spliced').flatMap(event => event.data.inserted)
    expect(JSON.stringify(queued)).not.toContain('Use the cited evidence only.')
    const visible = events.filter(event => event.type === 'user/message')
    expect(JSON.stringify(visible)).toContain('Use the cited evidence only.')
    expect(visible.every(event => event.data.source.kind === 'plugin')).toBe(true)
    expect(await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).toEqual(receipt)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
  })

  it('preserves a new user message visibly without treating copied host text as a reservation', async () => {
    const h = await setup()
    const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: 'Resume the reserved Conductor continuation.' }] })
    h.agent.followup(message)
    await h.agent.whenIdle()
    expect(h.agent.inbox.nextTurn.map(item => item.id)).toContain(message.id)
    expect(h.model.calls).toBe(0)
    expect(h.dispatches()).toBe(0)
    const result = await h.ctx.tools.execute({ name: 'read', arguments: {}, agent: h.agent,
      callId: CallId('blocked-read'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    await h.controller.respond(h.agent, binding, h.response, new AbortController().signal)
    await h.agent.whenIdle()
    expect(h.dispatches()).toBe(1)
    expect(h.agent.inbox.nextTurn.some(item => item.id === message.id)
      || h.agent.session.events.some(event => event.type === 'user/message' && event.data.id === message.id)).toBe(true)
  })

  it('rejects an owner response without any model turn or specialist dispatch', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const receipt = await h.controller.respond(h.agent, binding, { ...h.response, action: 'reject', answers: [] }, new AbortController().signal)
    await h.agent.whenIdle()
    expect(receipt.status).toBe('aborted')
    expect(h.model.calls).toBe(0)
    expect(h.dispatches()).toBe(0)
    expect((await h.store.load(h.run.runId))?.status).toBe('aborted')
    expect(h.agent.session.events.some(event => event.type === 'conductor/owner-terminal-rejection')).toBe(true)
    expect(await h.controller.respond(h.agent, binding, { ...h.response, action: 'reject', answers: [] }, new AbortController().signal)).toEqual(receipt)
    await expect(h.controller.respond(h.agent, binding, h.response, new AbortController().signal)).rejects.toThrow()
    h.controller.cancel(h.agent)
    await expect(h.controller.resumePending(h.agent, h.run.runId, new AbortController().signal)).rejects.toThrow('no pending')
  })

  it.each(['queued', 'response-flush', 'acknowledgement-flush', 'consumption-flush'] as const)(
    'does not dispatch after cancellation at %s', async (boundary) => {
      const h = await setup()
      const binding = await h.controller.reconnect(h.agent, h.run.runId)
      const abort = new AbortController()
      let responseFlushes = 0
      h.ctx.on('agent/inbox/inserted', ({ message }) => {
        if (boundary === 'queued' && message.content.some(block => block.type === 'text' && block.text.startsWith('Record owner reservation '))) abort.abort()
      })
      h.ctx.on('session/flush', () => {
        const events = h.agent.session.events
        if (events.some(event => event.type === 'conductor/owner-response-recorded')) responseFlushes += 1
        if (boundary === 'response-flush' && responseFlushes === 1
          || boundary === 'acknowledgement-flush' && responseFlushes === 2) abort.abort()
        if (boundary === 'consumption-flush' && events.some(event => event.type === 'conductor/owner-continuation-consumed')) {
          h.controller.cancel(h.agent)
        }
      })
      const operation = h.controller.respond(h.agent, binding, h.response, abort.signal)
      if (boundary === 'consumption-flush') await operation
      else await expect(operation).rejects.toThrow()
      await h.agent.whenIdle()
      expect(h.dispatches()).toBe(0)
      const saved = (await h.store.load(h.run.runId))!
      expect(saved.status).toBe(boundary === 'queued' ? 'awaiting_owner'
        : boundary === 'consumption-flush' ? 'rework' : 'continuation_pending')
      expect(saved.executionAuthorization).toBeNull()
      if (boundary !== 'consumption-flush') expect(h.model.calls).toBe(0)
    },
  )

  it('neutralizes a real queued reservation after restart when no answer was persisted', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const abort = new AbortController()
    let prefix: SessionEvent[] = []
    h.ctx.on('agent/inbox/inserted', ({ message }) => {
      if (!message.content.some(block => block.type === 'text' && block.text.startsWith('Record owner reservation '))) return
      prefix = JSON.parse(JSON.stringify(h.agent.session.events)) as SessionEvent[]
      abort.abort()
    })
    await expect(h.controller.respond(h.agent, binding, h.response, abort.signal)).rejects.toThrow()
    await h.agent.whenIdle()
    expect(prefix.length).toBeGreaterThan(0)
    const restarted = await setup(prefix)
    restarted.agent.followup(createUserMessage({ source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-tool-conductor/owner-controller' },
      content: [{ type: 'text', text: 'Neutralize stale host reservation.' }] }))
    await restarted.agent.whenIdle()
    expect(restarted.dispatches()).toBe(0)
    expect(restarted.model.calls).toBe(0)
    expect((await restarted.store.load(restarted.run.runId))?.status).toBe('awaiting_owner')
  })

  it('recovers a saved answer without reapplying it or dispatching on an identical duplicate', async () => {
    const h = await setup()
    const binding = await h.controller.reconnect(h.agent, h.run.runId)
    const abort = new AbortController()
    let flushes = 0
    h.ctx.on('session/flush', () => {
      if (!h.agent.session.events.some(event => event.type === 'conductor/owner-response-recorded')) return
      if (++flushes === 2) abort.abort()
    })
    await expect(h.controller.respond(h.agent, binding, h.response, abort.signal)).rejects.toThrow()
    await h.agent.whenIdle()
    const restarted = await setup(h.agent.session.events)
    await restarted.agent.whenIdle()
    expect(restarted.dispatches()).toBe(0)
    const receipt = await restarted.controller.respond(restarted.agent, binding, restarted.response, new AbortController().signal)
    expect(receipt.revision).toBe(2)
    expect(restarted.dispatches()).toBe(0)
    expect((await restarted.store.load(restarted.run.runId))?.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'answer'])
    await restarted.controller.resumePending(restarted.agent, restarted.run.runId, new AbortController().signal)
    await restarted.agent.whenIdle()
    expect(restarted.dispatches()).toBe(1)
    expect((await restarted.store.load(restarted.run.runId))?.ownerLedger.map(entry => entry.kind)).toEqual(['question', 'answer', 'consumed'])
  })
})
