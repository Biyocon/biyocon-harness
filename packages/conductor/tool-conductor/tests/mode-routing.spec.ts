import { Context } from '@deepseek-ai/cordis'
import { agentEvents, assembleContextFor } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { installModeRouting } from '../src/mode-routing.ts'

const contexts: Context[] = []
afterEach(async () => { for (const ctx of contexts.splice(0)) await ctx.fiber.dispose() })

async function setup(scoped = false) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  let reads = 0
  let outcome: JsonValue = { result: { kind: 'blocked' } }
  let fail = false
  ctx.tools.register(defineTool({
    name: 'read', description: 'read', parameters: {},
    output: { schema: { type: 'null' }, render: () => [] },
    execute: () => { reads += 1; return Promise.resolve(null) },
  }))
  const agent = ctx.agentLoop.create(SessionId('routing-parent'), {})
  const execute = (name: string, subject = agent) => ctx.tools.execute({
    name, agent: subject, arguments: {}, callId: CallId(`routing-${name}`), signal: new AbortController().signal,
  })
  ctx.tools.register(defineTool({
    name: 'conductor', description: 'conductor', parameters: {},
    output: { schema: { type: 'json' }, render: () => [] },
    execute: async () => {
      expect((await execute('read')).isError).toBe(true)
      if (fail) throw new Error('Conductor failed')
      return outcome
    },
  }))
  const fiber = await (scoped ? agent.ctx : ctx).plugin({ name: 'mode-routing-test', inject: ['tools'], apply: installModeRouting })
  const task = async (step = 1, user = true) => {
    const messages = [createUserMessage({
      content: [{ type: 'text', text: 'Analyze this project.' }],
      source: user ? { kind: 'user' } : { kind: 'plugin', plugin: 'test' },
    })]
    for (const message of messages) agentEvents(ctx, agent).emit('agent/inbox/claimed', { message, turn: 1 })
    return agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages, turn: 1, step, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages }))
  }
  const tools = async () => (await ctx.systemPrompt.assemble(assembleContextFor(agent))).tools.map(tool => tool.name)
  return { ctx, agent, execute, task, tools, fiber, reads: () => reads,
    outcome: (value: JsonValue) => { outcome = value }, fail: () => { fail = true } }
}

describe('Conductor mode parent routing', () => {
  it('hides and denies workspace tools before dispatch and after a blocker, including same-step fallback', async () => {
    const h = await setup()
    expect(await h.tools()).toEqual(['conductor'])
    expect((await h.execute('read')).isError).toBe(true)
    await h.task()
    expect(await h.tools()).toEqual(['conductor'])
    expect((await h.execute('read')).isError).toBe(true)
    expect((await h.execute('conductor')).isError).toBe(false)
    expect(await h.tools()).toEqual([])
    expect((await h.execute('read')).isError).toBe(true)
    expect((await h.execute('conductor')).isError).toBe(true)
    expect(h.reads()).toBe(0)
    await h.task(2, false)
    expect(await h.tools()).toEqual([])
    await h.task(3)
    expect(await h.tools()).toEqual(['conductor'])
  })

  it('leaves post-GO capabilities unchanged, then requires a new dispatch for the next task', async () => {
    const h = await setup()
    await h.task()
    h.outcome({ result: { kind: 'decision' } })
    expect((await h.execute('conductor')).isError).toBe(false)
    expect(await h.tools()).toEqual(['conductor', 'read'])
    expect((await h.execute('read')).isError).toBe(false)
    await h.task()
    expect((await h.execute('read')).isError).toBe(true)
    expect(h.reads()).toBe(1)
  })

  it('prevents solo fallback after a tool error or any non-decision result', async () => {
    for (const value of [null, [], {}, { result: null }, { result: [] }, { result: 'unknown' }]) {
      const h = await setup()
      await h.task()
      h.outcome(value)
      await h.execute('conductor')
      expect((await h.execute('read')).isError).toBe(true)
    }
    const h = await setup()
    await h.task()
    h.fail()
    expect((await h.execute('conductor')).isError).toBe(true)
    expect((await h.execute('read')).isError).toBe(true)
    expect(h.reads()).toBe(0)
  })

  it('rejects a turn that silently skipped Conductor instead of completing the task solo', async () => {
    const h = await setup()
    await expect(agentEvents(h.ctx, h.agent).serial('agent/turn-stopping', {
      turn: 1, signal: new AbortController().signal,
    })).rejects.toThrow('ended without calling conductor')
    await h.execute('conductor')
    await expect(agentEvents(h.ctx, h.agent).serial('agent/turn-stopping', {
      turn: 1, signal: new AbortController().signal,
    })).resolves.toBeUndefined()
  })

  it('does not unlock fallback when post-execute policy rejects a provisional GO', async () => {
    const h = await setup()
    h.outcome({ result: { kind: 'decision' } })
    h.ctx.on('tools/post-execute', (exec, _result, next) => exec.name === 'conductor'
      ? Promise.resolve({ kind: 'block' as const, feedback: [{ type: 'text' as const, text: 'output rejected' }] })
      : next())
    expect((await h.execute('conductor')).isError).toBe(true)
    expect((await h.execute('read')).isError).toBe(true)
    expect(h.reads()).toBe(0)
  })

  it('keeps parent agents outside the mounting scope unchanged', async () => {
    const h = await setup(true)
    const other = h.ctx.agentLoop.create(SessionId('ordinary-parent'), {})
    expect((await h.execute('read')).isError).toBe(true)
    expect((await h.execute('read', other)).isError).toBe(false)
    expect((await h.ctx.systemPrompt.assemble(assembleContextFor(other))).tools.map(tool => tool.name))
      .toEqual(['conductor', 'read'])
    expect(await h.tools()).toEqual(['conductor'])
  })

  it('does not restrict specialists, unrelated assemblies or calls without an agent, and disposes its policy', async () => {
    const h = await setup()
    const { agent: child } = await h.ctx.agents.create({ sessionId: SessionId('routing-child'), meta: { origin: 'subagent' } })
    const messages = [createUserMessage({ content: [], source: { kind: 'user' } })]
    await agentEvents(h.ctx, child).waterfall('agent/pre-step', {
      messages, turn: 1, step: 1, signal: new AbortController().signal,
    }, () => Promise.resolve({ kind: 'enter' as const, messages }))
    expect((await h.execute('read', child)).isError).toBe(false)
    expect((await h.ctx.systemPrompt.assemble()).tools.map(tool => tool.name)).toEqual(['conductor', 'read'])
    expect((await h.ctx.tools.execute({ name: 'read', arguments: {}, callId: CallId('host-read'),
      signal: new AbortController().signal })).isError).toBe(false)
    await h.fiber.dispose()
    expect((await h.execute('read')).isError).toBe(false)
  })
})
