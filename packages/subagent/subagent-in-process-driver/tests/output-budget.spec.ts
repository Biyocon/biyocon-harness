import { Context } from '@deepseek-ai/cordis'
import { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from 'vitest'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import { startInProcessRun } from '../src/index.ts'
import { snapshotSubagentDescriptor } from '@deepseek-ai/dsh-subagent'

type Script = ConstructorParameters<typeof MockAdapter>[0]

async function setup(script: Script, supported = true, override?: MockAdapter) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const adapter = override ?? new MockAdapter(script, undefined, 100, supported)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('budget-parent'), { provider: 'mock', model: 'mock' })
  return { ctx, adapter, parent }
}

function request(parent: Agent, maxOutputTokens: number) {
  return {
    prompt: [{ type: 'text' as const, text: 'budgeted task' }],
    parent,
    signal: new AbortController().signal,
    maxOutputTokens,
    descriptor: snapshotSubagentDescriptor({ mode: 'one-shot', provider: 'test' }),
  }
}

function endCode(agent: Agent): string | undefined {
  const last = agent.session.events.findLast(event => event.type === 'turn/end')
  return last?.type === 'turn/end' && last.data.reason.kind === 'error'
    ? last.data.reason.error.code
    : undefined
}

describe('in-process child output-token limit', () => {
  it('clamps every request to the remaining cumulative budget, including reasoning', async () => {
    const first = toolCallResponse('call-1', 'noop', {})
    const usage = first.find(chunk => chunk.type === 'usage')
    if (usage?.type !== 'usage') throw new Error('fixture has no usage')
    usage.usage.reasoningTokens = 4
    const { ctx, adapter, parent } = await setup([first, textResponse('hey')])
    ctx.on('agent/request', async (_payload, next) => ({ ...await next(), maxTokens: 90 }))
    const disposeTool = ctx.tools.register(defineContentToolFixture({
      name: 'noop', description: 'no operation', parameters: {},
      execute: () => Promise.resolve([{ type: 'text', text: 'done' }]),
    }))
    const run = await startInProcessRun(request(parent, 8), {})
    expect((await run.result).stopReason).toBe('completed')
    expect(adapter.requests.map(call => call.maxTokens)).toEqual([8, 3])
    expect(adapter.requests.map(call => call.requireOutputTokenLimit)).toEqual([true, true])
    await run.dispose()
    disposeTool()
  })

  it('charges a failed attempt before a retry within the same step', async () => {
    const failed: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 4, reasoningTokens: 3 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'transient', code: 'SERVER' } } },
    ]
    const { ctx, adapter, parent } = await setup([failed, textResponse('x')])
    let retries = 0
    ctx.on('agent/request-error', () => { retries++; return Promise.resolve({ kind: 'retry' as const }) })
    const run = await startInProcessRun(request(parent, 5), {})
    expect((await run.result).stopReason).toBe('completed')
    expect(retries).toBe(1)
    expect(adapter.requests.map(call => call.maxTokens)).toEqual([5, 1])
    await run.dispose()
  })

  it('fails closed when actual output exceeds the requested cap, without retry', async () => {
    const { ctx, adapter, parent } = await setup([textResponse('four'), textResponse('unused')])
    let retries = 0
    ctx.on('agent/request-error', () => { retries++; return Promise.resolve({ kind: 'retry' as const }) })
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('OUTPUT_TOKEN_LIMIT_EXCEEDED')
    expect(adapter.requests).toHaveLength(1)
    expect(retries).toBe(0)
    await run.dispose()
  })

  it('treats invalid reasoning-inclusive usage as a terminal child error', async () => {
    const invalid = textResponse('ok')
    const usage = invalid.find(chunk => chunk.type === 'usage')
    if (usage?.type !== 'usage') throw new Error('fixture has no usage')
    usage.usage.reasoningTokens = 3
    const { parent } = await setup([invalid])
    const run = await startInProcessRun(request(parent, 5), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('OUTPUT_TOKEN_USAGE_INVALID')
    await run.dispose()
  })

  it('does not retry an error that spent the last available output token', async () => {
    const failed: StreamChunk[] = [
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 3, reasoningTokens: 2 } },
      { type: 'finish', reason: { kind: 'error', failure: { message: 'transient', code: 'SERVER' } } },
    ]
    const { ctx, adapter, parent } = await setup([failed, textResponse('unused')])
    let retries = 0
    ctx.on('agent/request-error', () => { retries++; return Promise.resolve({ kind: 'retry' as const }) })
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('OUTPUT_TOKEN_LIMIT_EXCEEDED')
    expect(adapter.requests).toHaveLength(1)
    expect(retries).toBe(0)
    await run.dispose()
  })

  it('fails closed when an attempted call reports no usage', async () => {
    const missing = textResponse('ok').filter(chunk => chunk.type !== 'usage')
    const { ctx, adapter, parent } = await setup([missing, textResponse('unused')])
    let retries = 0
    ctx.on('agent/request-error', () => { retries++; return Promise.resolve({ kind: 'retry' as const }) })
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('OUTPUT_TOKEN_USAGE_MISSING')
    expect(adapter.requests).toHaveLength(1)
    expect(retries).toBe(0)
    await run.dispose()
  })

  it('does not retry a failed attempt whose output usage is missing', async () => {
    const failed: StreamChunk[] = [
      { type: 'finish', reason: { kind: 'error', failure: { message: 'transient', code: 'SERVER' } } },
    ]
    const { ctx, adapter, parent } = await setup([failed, textResponse('unused')])
    let retries = 0
    ctx.on('agent/request-error', () => { retries++; return Promise.resolve({ kind: 'retry' as const }) })
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('OUTPUT_TOKEN_USAGE_MISSING')
    expect(adapter.requests).toHaveLength(1)
    expect(retries).toBe(0)
    await run.dispose()
  })

  it('rejects an invalid host-owned cap before publishing an agent', async () => {
    const { ctx } = await setup([])
    await expect(ctx.agents.create({
      sessionId: SessionId('invalid-budget'),
      agentOptions: { provider: 'mock', model: 'mock' },
      maxOutputTokens: 0,
    })).rejects.toThrow('positive safe integer')
    expect(ctx.agents.get(SessionId('invalid-budget'))).toBeUndefined()
  })

  it('refuses an adapter without a reasoning-inclusive cap before provider I/O', async () => {
    const { adapter, parent } = await setup([textResponse('unused')], false)
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('UNSUPPORTED_OUTPUT_TOKEN_LIMIT')
    expect(adapter.requests).toHaveLength(0)
    await run.dispose()
  })

  it('refuses a route that loses its cap guarantee between preparation and stream', async () => {
    class SwitchingAdapter extends MockAdapter {
      lookups = 0
      override async resolveModel(provider: string, model: string) {
        const info = await super.resolveModel(provider, model)
        this.lookups++
        if (this.lookups === 1) return info
        const { enforcesMaxTokensIncludingReasoning: _guarantee, ...unsupported } = info
        return unsupported
      }
    }
    const switching = new SwitchingAdapter([textResponse('unused')], undefined, 100, true)
    const { parent } = await setup([], true, switching)
    const run = await startInProcessRun(request(parent, 3), {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('UNSUPPORTED_OUTPUT_TOKEN_LIMIT')
    expect(switching.lookups).toBe(2)
    expect(switching.requests).toHaveLength(0)
    await run.dispose()
  })

  it('refuses a capped child when its selected model route has no adapter', async () => {
    const { parent } = await setup([])
    const run = await startInProcessRun({
      ...request(parent, 3),
      agentOptions: { provider: 'missing', model: 'missing' },
    }, {})
    expect((await run.result).stopReason).toBe('error')
    expect(endCode(run.localAgent!)).toBe('UNSUPPORTED_OUTPUT_TOKEN_LIMIT')
    await run.dispose()
  })

  it('refuses a later turn after a completed call spent the whole child budget', async () => {
    const { ctx, adapter } = await setup([textResponse('hey'), textResponse('unused')])
    const handle = await ctx.agents.create({
      sessionId: SessionId('two-turn-budget'),
      agentOptions: { provider: 'mock', model: 'mock' },
      maxOutputTokens: 3,
    })
    const agent = handle.agent
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'one' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    agent.followup(createUserMessage({ content: [{ type: 'text', text: 'two' }], source: { kind: 'user' } }))
    await agent.whenIdle()
    expect(endCode(agent)).toBe('OUTPUT_TOKEN_LIMIT_EXCEEDED')
    expect(adapter.requests).toHaveLength(1)
    await handle.dispose()
  })

  it('does not let a direct LLM caller bypass the required adapter assurance', async () => {
    const { ctx, adapter } = await setup([textResponse('unused')], false)
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'mock', model: 'mock', messages: [], maxTokens: 3, requireOutputTokenLimit: true,
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'UNSUPPORTED_OUTPUT_TOKEN_LIMIT' } },
    })
    expect(adapter.requests).toHaveLength(0)
  })

  it.each([undefined, 0, 1.5])('refuses a direct assurance without a valid explicit maxTokens (%s)', async (maxTokens) => {
    const { ctx, adapter } = await setup([textResponse('unused')])
    const chunks = []
    for await (const chunk of ctx.llm.stream({
      provider: 'mock', model: 'mock', messages: [],
      ...maxTokens === undefined ? {} : { maxTokens },
      requireOutputTokenLimit: true,
    })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({
      type: 'finish', reason: { kind: 'error', failure: { code: 'INVALID_OUTPUT_TOKEN_LIMIT' } },
    })
    expect(adapter.requests).toHaveLength(0)
  })

  it('does not execute tool calls after the cumulative cap is exhausted', async () => {
    const { ctx, adapter, parent } = await setup([toolCallResponse('call-1', 'noop', {})])
    let toolCalls = 0
    const disposeTool = ctx.tools.register(defineContentToolFixture({
      name: 'noop', description: 'no operation', parameters: {},
      execute: () => { toolCalls++; return Promise.resolve([{ type: 'text', text: 'done' }]) },
    }))
    const run = await startInProcessRun(request(parent, 5), {})
    expect((await run.result).stopReason).toBe('max-tokens')
    expect(adapter.requests).toHaveLength(1)
    expect(toolCalls).toBe(0)
    await run.dispose()
    disposeTool()
  })
})
