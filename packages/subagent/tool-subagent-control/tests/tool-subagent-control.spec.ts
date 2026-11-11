import { afterEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as tool from '../src/index.ts'
import { parkParent } from './park-parent.ts'

/** One scripted response that may wait on a caller-released gate before streaming. */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private script: GatedEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('GatedAdapter: script exhausted')
    if (entry.gate) await entry.gate
    for (const chunk of entry.chunks) {
      if (options.signal?.aborted) throw new Error('aborted')
      yield chunk
    }
  }
}

const testToolSignal = new AbortController().signal

const roots: string[] = []
const contexts: Context[] = []
const gateReleases: (() => void)[] = []

function fixtureContext(): Context {
  const ctx = new Context()
  contexts.push(ctx)
  return ctx
}

/** Hold a scripted request until the test or fixture teardown releases it. */
function fixtureGate(): PromiseWithResolvers<undefined> {
  const gate = Promise.withResolvers<undefined>()
  gateReleases.push(() => { gate.resolve(undefined) })
  return gate
}

function removeFixtureRoot(root: string): void {
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/** Keep scratch data until every context and held model request is quiescent. */
async function cleanupFixtures(removeRoot: (root: string) => void = removeFixtureRoot): Promise<void> {
  const owners = contexts.splice(0)
  const closing = owners.map(async ctx => ctx.fiber.dispose())
  for (const release of gateReleases.splice(0)) release()
  const failures: unknown[] = []
  for (const [index, outcome] of (await Promise.allSettled(closing)).entries()) {
    if (outcome.status === 'rejected') {
      contexts.push(owners[index]!)
      failures.push(outcome.reason)
    }
  }
  if (failures.length > 0) throw new AggregateError(failures, 'fixture context teardown failed; scratch data retained')
  for (const root of roots) removeRoot(root)
  roots.length = 0
}

afterEach(() => cleanupFixtures())

async function setupWith(adapter: MockAdapter | GatedAdapter) {
  const ctx = fixtureContext()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-tool-subagent-control-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(tool)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  parkParent(ctx, parent)
  return { ctx, parent, adapter, root }
}

async function setup(script: ConstructorParameters<typeof MockAdapter>[0]) {
  return setupWith(new MockAdapter(script))
}

function text(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

let calls = 0
function callTool(
  ctx: Context,
  name: string,
  args: unknown,
  agent?: unknown,
  signal: AbortSignal = testToolSignal,
) {
  return ctx.tools.execute({
    signal,
    callId: CallId(`call-${++calls}`),
    name,
    arguments: args,
    ...agent !== undefined ? { agent: agent as never } : {},
  })
}

/** Wait until a child's Activation released its handle. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)?.id).toBeUndefined()
  }, { timeout: 5_000 })
}

describe('dsh-tool-subagent-control', () => {
  it('drains a held child and unregisters agents before removing fixture data', async () => {
    const held = fixtureGate()
    const adapter = new GatedAdapter([{ chunks: textResponse('held'), gate: held.promise }])
    const { ctx, parent, root } = await setupWith(adapter)
    const registry = ctx.agents
    await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'held cleanup proof',
      request: { prompt: [{ type: 'text', text: 'held until teardown' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    expect(registry.list()).toHaveLength(2)

    await cleanupFixtures((directory) => {
      expect(directory).toBe(root)
      expect(registry.list()).toHaveLength(0)
      expect(existsSync(directory)).toBe(true)
      removeFixtureRoot(directory)
    })

    expect(existsSync(root)).toBe(false)
    expect(registry.list()).toHaveLength(0)
    expect(adapter.requests).toHaveLength(1)
  })

  it('drains other contexts and retains scratch data when one context fails to close', async () => {
    const first = await setup([])
    const second = await setup([])
    const secondRegistry = second.ctx.agents
    const close = first.ctx.fiber.dispose.bind(first.ctx.fiber)
    const failure = new Error('synthetic fixture close failure')
    const dispose = vi.spyOn(first.ctx.fiber, 'dispose').mockRejectedValueOnce(failure)
    try {
      await expect(cleanupFixtures()).rejects.toMatchObject({
        name: 'AggregateError', errors: [failure],
        message: 'fixture context teardown failed; scratch data retained',
      })
      expect(secondRegistry.list()).toHaveLength(0)
      expect(existsSync(first.root)).toBe(true)
      expect(existsSync(second.root)).toBe(true)
      dispose.mockRestore()
      await cleanupFixtures()
      expect(existsSync(first.root)).toBe(false)
      expect(existsSync(second.root)).toBe(false)
    } finally {
      dispose.mockRestore()
      await close()
    }
  })

  it('reports a retained activation without formatting its scoped context', async () => {
    const { ctx } = await setup([])
    const handle = await ctx.agents.create({
      sessionId: SessionId('diagnostic-retained'),
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    const waiting = vi.spyOn(vi, 'waitFor')
    const pending = waitNoActivation(ctx, handle.agent.id)
    try {
      // Inspect the actual polling assertion while the target is still live;
      // dispose it afterward so this regression does not wait for the timeout.
      expect(waiting.mock.calls[0]![0]).toThrow(expect.objectContaining({
        name: 'AssertionError',
        actual: handle.agent.id,
        expected: undefined,
      }))
      expect(waiting).toHaveBeenCalledWith(expect.any(Function), { timeout: 5_000 })
    } finally {
      try {
        await handle.dispose()
        await pending
      } finally {
        waiting.mockRestore()
        await ctx.fiber.dispose()
      }
    }
  })

  it('registers send_message once, globally, with the two required parameters', async () => {
    const { ctx } = await setup([])
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'send_message')
    expect(schemas).toHaveLength(1)
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props).sort()).toEqual(['message', 'subagent_id'])
    // The continuable path has no Task, so the schema must not promise one.
    expect(schemas[0]!.description).not.toContain('job_output')
    expect(schemas[0]!.description).not.toContain('job id')
    // Follow-up ordering is model-visible: it cannot redirect the open turn.
    expect(schemas[0]!.description).toContain('next turn')
  })

  it('cold-resumes a settled child and reports the queued next turn', async () => {
    const { ctx, parent } = await setup([textResponse('first answer'), textResponse('second answer')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'and then?',
    }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`message queued as the next turn for subagent ${started.childId}`)
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    const followUp = loaded.events.findLast(event => event.type === 'user/message')
    // The durable message source records the calling agent without granting authority.
    expect(followUp?.type === 'user/message' && followUp.data.source).toEqual({
      kind: 'coordinator',
      form: 'relay',
      senderSessionId: parent.id,
    })
  })

  it('queues behind an open turn instead of joining it', async () => {
    const { ctx, parent, adapter } = await setup([textResponse('first'), textResponse('second')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })

    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'also consider Y',
    }, parent)
    expect(result.isError).toBe(false)

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    // A follow-up is its own later turn, never steering inside the first one.
    expect(prompts).toEqual(['long work', 'also consider Y'])
  })

  it('reports a delivery failure as an errored, not-delivered result', async () => {
    const { ctx, parent } = await setup([])
    const result = await callTool(ctx, 'send_message', {
      subagent_id: 'no-such-child',
      message: 'hello?',
    }, parent)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('unavailable')
  })

  it('rejects a caller that is not the child\'s durable direct parent', async () => {
    const { ctx, parent } = await setup([textResponse('first')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child task',
      request: { prompt: [{ type: 'text', text: 'child task' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })

    const result = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'mine now',
    }, stranger)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('another parent session')
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    const result = await callTool(ctx, 'send_message', { subagent_id: 'x', message: 'y' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })

  it('unregisters with its plugin fiber (HMR safety)', async () => {
    const ctx = fixtureContext()
    await mountAgentLoopTestDependencies(ctx)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(SubagentRuntime)
    const fiber = await ctx.plugin(tool)
    expect(ctx.tools.schemas().some(schema => schema.name === 'send_message')).toBe(true)
    expect(ctx.tools.schemas().some(schema => schema.name === 'interrupt_agent')).toBe(true)
    await fiber.dispose()
    expect(ctx.tools.schemas().some(schema => schema.name === 'send_message')).toBe(false)
    expect(ctx.tools.schemas().some(schema => schema.name === 'interrupt_agent')).toBe(false)
  })

  it('has the namespace-plugin export shape (no stray default)', () => {
    expect('default' in tool).toBe(false)
    expect(tool.name).toBe('tool-subagent-control')
    expect(tool.inject).toEqual(['tools', 'subagents'])
    expect(typeof tool.apply).toBe('function')
  })
})

describe('dsh-tool-subagent-control interrupt_agent', () => {
  it('registers interrupt_agent with the single agent_id parameter and current-turn wording', async () => {
    const { ctx } = await setup([])
    const schemas = ctx.tools.schemas().filter(schema => schema.name === 'interrupt_agent')
    expect(schemas).toHaveLength(1)
    const props = (schemas[0]!.parameters as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(['agent_id'])
    expect(schemas[0]!.description).toContain('current turn')
    expect(schemas[0]!.description).toContain('send_message')
  })

  it('interrupts a running direct child with the parent cause, parking its queue', async () => {
    const releaseFirst = fixtureGate()
    const adapter = new GatedAdapter([
      { chunks: textResponse('held'), gate: releaseFirst.promise },
      { chunks: textResponse('parked answer') },
      { chunks: textResponse('waking answer') },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'long work',
      request: { prompt: [{ type: 'text', text: 'long work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const queued = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'parked follow-up',
    }, parent)
    expect(queued.isError).toBe(false)
    const cancelSpy = vi.spyOn(child, 'cancel')

    const result = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)

    expect(result.isError).toBe(false)
    expect(text(result)).toBe(`interrupt requested for agent ${started.childId}`)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseFirst.resolve(undefined)
    await child.whenIdle()
    // Parked, not resumed: the queued follow-up waits for a waking send.
    expect(adapter.requests).toHaveLength(1)
    expect(child.inbox.nextTurn).toHaveLength(1)

    const waking = await callTool(ctx, 'send_message', {
      subagent_id: started.childId,
      message: 'wake up',
    }, parent)
    expect(waking.isError).toBe(false)
    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    const prompts = loaded.events.flatMap(event => event.type === 'user/message' && event.data.source.kind !== 'plugin'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text] : [])
      : [])
    expect(prompts).toEqual(['long work', 'parked follow-up', 'wake up'])
  })

  it('lets a deep live ancestor interrupt a descendant it did not directly create', async () => {
    const releaseChild = fixtureGate()
    const releaseGrandchild = fixtureGate()
    const adapter = new GatedAdapter([
      { chunks: textResponse('child'), gate: releaseChild.promise },
      { chunks: textResponse('grandchild'), gate: releaseGrandchild.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const child = ctx.agents.get(started.childId)!
    const grandchild = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'grandchild',
      request: { prompt: [{ type: 'text', text: 'grandchild work' }], parent: child },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const grandchildAgent = ctx.agents.get(grandchild.childId)!
    const cancelSpy = vi.spyOn(grandchildAgent, 'cancel')

    const result = await callTool(ctx, 'interrupt_agent', { agent_id: grandchild.childId }, parent)

    expect(result.isError).toBe(false)
    expect(cancelSpy).toHaveBeenCalledExactlyOnceWith({ kind: 'parent' }, { keepInbox: true })
    releaseChild.resolve(undefined)
    releaseGrandchild.resolve(undefined)
    await waitNoActivation(ctx, grandchild.childId)
    await waitNoActivation(ctx, started.childId)
  })

  it('rejects self, sibling, and unrelated callers without touching the target', async () => {
    const releaseA = fixtureGate()
    const releaseB = fixtureGate()
    const adapter = new GatedAdapter([
      { chunks: textResponse('a'), gate: releaseA.promise },
      { chunks: textResponse('b'), gate: releaseB.promise },
    ])
    const { ctx, parent } = await setupWith(adapter)
    const target = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'target',
      request: { prompt: [{ type: 'text', text: 'a' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(1) })
    const sibling = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'sibling',
      request: { prompt: [{ type: 'text', text: 'b' }], parent },
      signal: testToolSignal,
    })
    await vi.waitFor(() => { expect(adapter.requests).toHaveLength(2) })
    const targetAgent = ctx.agents.get(target.childId)!
    const siblingAgent = ctx.agents.get(sibling.childId)!
    const stranger = ctx.agentLoop.create(SessionId('stranger'), { provider: 'mock', model: 'mock' })
    const cancelSpy = vi.spyOn(targetAgent, 'cancel')

    const self = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, targetAgent)
    expect(self.isError).toBe(true)
    expect(text(self)).toContain('cannot interrupt itself')
    const fromSibling = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, siblingAgent)
    expect(fromSibling.isError).toBe(true)
    expect(text(fromSibling)).toContain('not a live descendant')
    const fromStranger = await callTool(ctx, 'interrupt_agent', { agent_id: target.childId }, stranger)
    expect(fromStranger.isError).toBe(true)
    expect(text(fromStranger)).toContain('not a live descendant')
    expect(cancelSpy).not.toHaveBeenCalled()

    releaseA.resolve(undefined)
    releaseB.resolve(undefined)
    await waitNoActivation(ctx, target.childId)
    await waitNoActivation(ctx, sibling.childId)
  })

  it('accepts an absent target as a no-op without cold-resuming it', async () => {
    const { ctx, parent } = await setup([textResponse('done')])
    const started = await ctx.subagents.startContinuable({
      provider: 'spawn',
      label: 'settled child',
      request: { prompt: [{ type: 'text', text: 'child work' }], parent },
      signal: testToolSignal,
    })
    await waitNoActivation(ctx, started.childId)

    const settled = await callTool(ctx, 'interrupt_agent', { agent_id: started.childId }, parent)
    expect(settled.isError).toBe(false)
    expect(text(settled)).toBe(`interrupt requested for agent ${started.childId}`)
    const unknown = await callTool(ctx, 'interrupt_agent', { agent_id: 'no-such-agent' }, parent)
    expect(unknown.isError).toBe(false)
    // No cold resume: the settled target never rematerialized.
    expect(ctx.agents.get(started.childId)).toBeUndefined()
  })

  it('fails loud when invoked without a calling agent', async () => {
    const { ctx } = await setup([])
    const result = await callTool(ctx, 'interrupt_agent', { agent_id: 'x' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires a calling agent')
  })
})
