/**
 * Continuable-child delegation policy: a fresh continuable start seeds the
 * parent's explicit sandbox override and the pinned `approval/policy: never`
 * onto the child's own log as `source: 'delegation'` events, and a cold
 * resume replays that persisted snapshot instead of re-capturing the parent
 * (the one-shot `subagent-inprocess/tests/inheritance.spec.ts` counterpart).
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SandboxPolicyService, { effectiveSandboxMode, setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentFork from '@deepseek-ai/dsh-subagent-fork-in-process'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import ApprovalService, { effectiveApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { MockAdapter, textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime from '../src/index.ts'

type Script = ConstructorParameters<typeof MockAdapter>[0]

const roots: string[] = []
const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0).reverse()) await ctx.fiber.dispose()
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Boot the continuable stack plus both policy services the manager consumes opportunistically. */
async function setup(script: Script) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-continuation-inherit-'))
  roots.push(root)
  await ctx.plugin(JsonlSessionPersistence, { root })
  await ctx.plugin(SandboxPolicyService, { mode: 'workspace-write', workspaceRoot: root })
  await ctx.plugin(ApprovalService)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  await ctx.plugin(SubagentFork, { providerName: 'fork' })
  const adapter = new MockAdapter(script)
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent, adapter }
}

function startSpec(parent: Agent, provider = 'spawn') {
  return {
    provider,
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal: new AbortController().signal,
  }
}

/** Wait until a child's Activation is gone, i.e. its handle finished disposal. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 15_000 })
}

function policyEvents(events: readonly SessionEvent[]) {
  return events.filter(event => event.type === 'sandbox/mode' || event.type === 'approval/policy')
}

describe('continuable policy inheritance', () => {
  it.each([
    { provider: 'spawn', restricted: false },
    { provider: 'spawn', restricted: true },
    { provider: 'fork', restricted: false },
    { provider: 'fork', restricted: true },
  ])('reassembles tool-associated guidance after cold resume: $provider / restricted=$restricted', async ({ provider, restricted }) => {
    const { ctx, parent, adapter } = await setup([textResponse('first'), textResponse('after resume')])
    ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (agent === parent) return { kind: 'reject' }
      return next()
    })
    ctx.tools.register(defineTool({
      name: 'lookup', description: 'Synthetic lookup.', parameters: {},
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: () => Promise.resolve('synthetic'),
    }))
    ctx.systemPrompt.section({ name: 'lookup-advice', order: 110, text: 'Synthetic lookup guidance.', requiresTools: ['lookup'] })
    const spec = startSpec(parent, provider)
    const started = await ctx.subagents.startContinuable({
      ...spec,
      request: { ...spec.request, ...restricted ? { toolFilter: { deny: ['lookup'] } } : {} },
    })
    await waitNoActivation(ctx, started.childId)
    await ctx.subagents.followup(parent, started.childId, [{ type: 'text', text: 'continue' }], {
      source: { kind: 'user' }, signal: new AbortController().signal,
    })
    await waitNoActivation(ctx, started.childId)
    expect(adapter.requests).toHaveLength(2)
    expect(adapter.requests.map(request => request.system?.includes('Synthetic lookup guidance.')))
      .toEqual([!restricted, !restricted])
    const loaded = await ctx.sessionPersistence.load(started.childId)
    const headers = loaded.events.filter(event => event.type === 'request/header')
    expect(headers.map(event => event.data.reason)).toEqual(['initial', 'resume'])
    expect(headers.map(event => event.data.header.system?.includes('Synthetic lookup guidance.')))
      .toEqual([!restricted, !restricted])
    const parentPrompt = await ctx.systemPrompt.assemble({ scope: parent, agent: parent })
    expect(parentPrompt.sections.some(section => section.name === 'lookup-advice')).toBe(true)
  })

  it('seeds the parent sandbox override and pins approval to never', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('child done')])
    setSandboxMode(parent.session, 'danger-full-access')
    // No parent approval override: the child pin must not depend on one.
    expect(ctx.approval.overrideOf(parent.session)).toBeUndefined()
    let child: Agent | undefined
    ctx.on('agent/created', ({ agent }) => {
      if (agent !== parent) child = agent
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    // The delegation events are appended in the creation window, so they are
    // already the child's effective policy at inbox acceptance.
    if (child === undefined) throw new Error('expected the continuable child to be created')
    expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('danger-full-access')
    expect(ctx.approval.overrideOf(child.session)).toBe('never')

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(policyEvents(loaded.events)).toMatchObject([
      { type: 'sandbox/mode', data: { mode: 'danger-full-access', source: 'delegation' } },
      { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
    ])
    // Durable: a reload folds the same effective policy.
    expect(effectiveSandboxMode(loaded.events)).toBe('danger-full-access')
    expect(effectiveApprovalPolicy(loaded.events)).toBe('never')
    expect(ctx.approval.overrideOf(parent.session)).toBeUndefined()
    const runtimeContext = loaded.events.find(
      (event): event is SessionEvent<'user/message'> => event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === '@deepseek-ai/dsh-system-prompt',
    )
    const contextText = runtimeContext?.data.content
      .flatMap(block => block.type === 'text' ? [block.text] : [])
      .join('\n')
    expect(contextText).toContain('You are a delegated subagent')
  })

  it('captures policy at delegation before asynchronous child creation', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('child done')])
    setSandboxMode(parent.session, 'read-only')

    const starting = ctx.subagents.startContinuable(startSpec(parent))
    // A parent switch after the synchronous capture belongs to the parent's
    // future, not to this child.
    setSandboxMode(parent.session, 'danger-full-access')
    const started = await starting

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(ctx.sandboxPolicy.overrideOf(parent.session)).toBe('danger-full-access')
    expect(effectiveSandboxMode(loaded.events)).toBe('read-only')
  })

  it('leaves an unswitched sandbox on the deployment default while still pinning approval', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('child done')])

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(policyEvents(loaded.events)).toMatchObject([
      { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
    ])
    expect(effectiveSandboxMode(loaded.events)).toBeUndefined()
  })

  it('pins approval after the fork prefix of an unswitched fork child', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('parent turn'), textResponse('forked child')])
    parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent work' }],
      source: { kind: 'user' },
    }))
    await parent.whenIdle()

    const started = await ctx.subagents.startContinuable(startSpec(parent, 'fork'))
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.seedLength).toBeGreaterThan(0)
    expect(policyEvents(loaded.events)).toMatchObject([
      { type: 'approval/policy', data: { policy: 'never', source: 'delegation' } },
    ])
    expect(effectiveSandboxMode(loaded.events)).toBeUndefined()
  })

  it('lets a later child-side switch win over the delegation snapshot', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('child done')])
    setSandboxMode(parent.session, 'danger-full-access')
    let child: Agent | undefined
    ctx.on('agent/created', ({ agent }) => {
      if (agent !== parent) child = agent
    })

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    if (child === undefined) throw new Error('expected the continuable child to be created')
    expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('danger-full-access')
    // Last event wins: the child's own runtime switch beats the seeded snapshot.
    setSandboxMode(child.session, 'read-only')
    expect(ctx.sandboxPolicy.overrideOf(child.session)).toBe('read-only')

    await waitNoActivation(ctx, started.childId)
    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(effectiveSandboxMode(loaded.events)).toBe('read-only')
  })

  it('cold-resumes on the persisted snapshot without re-capturing the parent', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('first'), textResponse('after resume')])
    setSandboxMode(parent.session, 'read-only')
    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, started.childId)

    // The parent widens AFTER the child was created; the resumed child keeps
    // the delegation-time snapshot from its own log.
    setSandboxMode(parent.session, 'danger-full-access')
    await ctx.subagents.followup(parent, started.childId, [{ type: 'text', text: 'continue please' }], {
      source: { kind: 'user' },
      signal: new AbortController().signal,
    })
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.events.filter(event => event.type === 'sandbox/mode')).toMatchObject([
      { data: { mode: 'read-only', source: 'delegation' } },
    ])
    expect(effectiveSandboxMode(loaded.events)).toBe('read-only')
    // The approval pin is seeded once at creation, never re-appended on resume.
    expect(loaded.events.filter(event => event.type === 'approval/policy')).toMatchObject([
      { data: { policy: 'never', source: 'delegation' } },
    ])
  })

  it('places inherited events after a fork prefix so fresh policy wins stale seed state', { timeout: 20_000 }, async () => {
    const { ctx, parent } = await setup([textResponse('parent turn'), textResponse('forked child')])
    // The stale mode lands inside the completed turn the fork seed replays.
    setSandboxMode(parent.session, 'workspace-write')
    parent.followup(createUserMessage({
      content: [{ type: 'text', text: 'parent work' }],
      source: { kind: 'user' },
    }))
    await parent.whenIdle()
    setSandboxMode(parent.session, 'read-only')

    const started = await ctx.subagents.startContinuable(startSpec(parent, 'fork'))
    await waitNoActivation(ctx, started.childId)

    const loaded = await ctx.sessionPersistence.load(started.childId)
    expect(loaded.meta.seedLength).toBeGreaterThan(0)
    expect(loaded.events.filter(event => event.type === 'sandbox/mode')).toMatchObject([
      { data: { mode: 'workspace-write' } },
      { data: { mode: 'read-only', source: 'delegation' } },
    ])
    expect(effectiveSandboxMode(loaded.events)).toBe('read-only')
  })
})
