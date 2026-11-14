import { mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { admitIntake, captureIntakeMaterial, ConductorRunId, createRun } from '@deepseek-ai/dsh-conductor'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as spawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { STRUCTURED_OUTPUT_TOOL } from '@deepseek-ai/dsh-subagent-in-process-driver'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import * as SearchTools from '@deepseek-ai/dsh-tool-fs-search'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { defineContentToolFixture } from '@deepseek-ai/dsh-tools'
import WorkflowWorker from '@deepseek-ai/dsh-workflow-worker-thread'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { detectiveSearchContribution, resolveDetectiveSearchPolicy } from '../src/detective-search.ts'
import type { DetectiveSearchSettings } from '../src/detective-search.ts'
import { MIN_DETECTIVE_SEARCH_RESULT_CHARS } from '../src/detective-search-page.ts'
import { dispatchAnalysisChild } from '../src/analysis-dispatch.ts'
import { MockAdapter, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'

const roots: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of roots.splice(0)) await ctx.fiber.dispose()
})

function text(result: { content: ContentBlock[] }): string {
  return result.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('')
}

function continuation(page: string): string {
  const match = /Next page: (?:glob|grep)\(\{"cursor":"([^"]+)"\}\)/.exec(page)
  if (match?.[1] === undefined) throw new Error('expected a search continuation')
  return match[1]
}

function entries(page: string): string[] {
  return page.split('\n\n').slice(1).join('\n\n').split('\n').filter(Boolean)
}

async function setup(settings: DetectiveSearchSettings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-detective-search-'))
  const cwd = join(root, 'workspace')
  const snapshots = join(root, 'private-search')
  await mkdir(join(cwd, '.git'), { recursive: true })
  for (const dir of ['alpha', 'beta', 'gamma']) {
    await mkdir(join(cwd, dir))
    for (let i = 0; i < 3; i += 1) await writeFile(join(cwd, dir, `file-${i}.ts`), `needle ${dir} ${i}\n`)
  }
  const ctx = new Context()
  roots.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  await ctx.plugin(SearchTools, { sampleOverCapGlobResults: false })
  const parent = ctx.agentLoop.create(SessionId('search-parent'), { provider: 'unused', model: 'unused' }, { cwd })
  const child = ctx.agentLoop.create(SessionId('detective-child'), { provider: 'unused', model: 'unused' }, { cwd })
  const sibling = ctx.agentLoop.create(SessionId('auditor-child'), { provider: 'unused', model: 'unused' }, { cwd })
  const policy = resolveDetectiveSearchPolicy({ detectiveSearchSnapshotRoot: snapshots, ...settings })
  const runId = ConductorRunId('CON-2026-5801')
  const install = detectiveSearchContribution(ctx, runId, policy)
  const dispose = install(child.ctx)
  let calls = 0
  const call = (name: string, args: unknown, agent = child) => ctx.tools.execute({
    name, arguments: args, agent, signal: new AbortController().signal, callId: CallId(`search-${++calls}`),
  })
  return { ctx, cwd, snapshots, parent, child, sibling, policy, runId, install, dispose, call }
}

describe('Detective search configuration', () => {
  it('resolves independent defaults without creating artifacts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-detective-config-'))
    const policy = resolveDetectiveSearchPolicy({ detectiveSearchSnapshotRoot: join(root, 'not-created') })
    expect(policy).toMatchObject({ globMaxChars: 4000, grepMaxChars: 4000,
      execution: { sampleOverCapGlobResults: true, globMaxResults: 100, grepMaxMatches: 250,
        grepMaxLineBytes: 2000, rawOutputMaxBytes: 20_000_000, timeoutMs: 30_000 } })
    expect(await readdir(root)).toEqual([])
    vi.stubEnv('DSH_HOME', root)
    try { expect(resolveDetectiveSearchPolicy({}).globMaxChars).toBe(4000) } finally { vi.unstubAllEnvs() }
  })

  it.each(['detectiveGlobMaxResultChars', 'detectiveGrepMaxResultChars'] as const)(
    'rejects invalid complete-result limits for %s', (field) => {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1,
        MIN_DETECTIVE_SEARCH_RESULT_CHARS - 1]) {
        expect(() => resolveDetectiveSearchPolicy({ [field]: value })).toThrow()
      }
      expect(() => resolveDetectiveSearchPolicy({ [field]: MIN_DETECTIVE_SEARCH_RESULT_CHARS })).not.toThrow()
    },
  )

  it.each(['globMaxResults', 'grepMaxMatches', 'grepMaxLineBytes', 'rawOutputMaxBytes', 'graceMs', 'stderrMaxBytes', 'timeoutMs'] as const)(
    'rejects invalid execution limits for %s', (field) => {
      for (const value of [0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => resolveDetectiveSearchPolicy({ detectiveSearch: { [field]: value } })).toThrow()
      }
    },
  )

  it('validates timers, storage limits, booleans, and absolute artifact roots', () => {
    for (const field of ['graceMs', 'timeoutMs']) {
      expect(() => resolveDetectiveSearchPolicy({ detectiveSearch: { [field]: MAX_TIMER_DELAY_MS + 1 } })).toThrow()
    }
    for (const value of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => resolveDetectiveSearchPolicy({ detectiveSearchSnapshotMaxBytes: value })).toThrow()
    }
    expect(() => resolveDetectiveSearchPolicy({ detectiveSearchSnapshotRoot: 'relative' })).toThrow('absolute path')
    expect(() => resolveDetectiveSearchPolicy({ detectiveSearch: { sampleOverCapGlobResults: 'yes' as never } })).toThrow()
  })
})

describe('Detective scoped search over real local ripgrep', () => {
  it('carries the trusted producer contribution through real workflow/spawn and logs both pages', async () => {
    const h = await setup({ detectiveSearch: { globMaxResults: 2 } })
    for (const name of ['read', 'read_image']) h.ctx.tools.register(defineContentToolFixture({ name,
      description: 'Inherited read capability; this scenario only discovers names.', parameters: {},
      execute: () => { throw new Error('This search-only scenario must not read file content') } }))
    await h.ctx.plugin(SubagentRuntime)
    await h.ctx.plugin(spawn, { providerName: 'spawn' })
    await h.ctx.plugin(SkillRegistry)
    await h.ctx.plugin(WorkflowWorker, { provider: 'spawn' })
    const parent = h.ctx.agentLoop.create(SessionId('dispatch-parent'), { provider: 'mock', model: 'mock' }, { cwd: h.cwd })
    const material = captureIntakeMaterial('current-request', 'Inspect the public synthetic source tree.',
      { sessionId: parent.session.id, eventIndex: 0 })
    const admission = admitIntake({ purpose: 'analysis', entry: 'detective', deliverable: 'answer',
      rationale: 'Inspect source names before answering.' }, [material])
    const run = createRun(h.runId, { admission, objective: 'Inspect the tree.', authority: { owner: 'user' },
      acceptanceCriteria: ['Disclose uninspected files.'] })
    const pages: string[] = []
    const adapter = new MockAdapter([
      (options) => {
        expect(options.tools?.find(tool => tool.name === 'glob')?.description).toContain('at most 4000 characters')
        return toolCallResponse('first-page', 'glob', { pattern: '**/*.ts' })
      },
      (options) => {
        const result = options.messages.flatMap(message => message.content).findLast(block => block.type === 'tool-result')
        if (result?.type !== 'tool-result') throw new Error('first page was not supplied to the model')
        pages.push(text(result))
        return toolCallResponse('second-page', 'glob', { cursor: continuation(pages[0]!) })
      },
      (options) => {
        const result = options.messages.flatMap(message => message.content).findLast(block => block.type === 'tool-result')
        if (result?.type !== 'tool-result') throw new Error('second page was not supplied to the model')
        pages.push(text(result))
        return toolCallResponse('producer-report', STRUCTURED_OUTPUT_TOOL, {
          run_id: h.runId, purpose: 'analysis', stage: 'detective', deliverable: 'answer', status: 'blocked',
          summary: 'More source inspection is needed.', material_ids: [material.id], blockers: ['Five files remain uninspected.'],
          assumptions: [], limitations: ['Only four file names inspected; file content has not been read.'],
        })
      },
    ])
    h.ctx.llm.registerAdapter(['mock'], adapter)
    const logs: Array<{ id: string; content: ContentBlock[] }> = []
    const failures: unknown[] = []
    h.ctx.on('session/event', (session, event) => {
      if (event.type === 'tool/result') logs.push({ id: session.id, content: event.data.message.content[0].content })
      if (event.type === 'turn/end' && event.data.reason.kind === 'error') failures.push(event.data.reason)
    })
    const result = await dispatchAnalysisChild({ mode: 'producer', ctx: h.ctx, providerName: 'spawn', parent,
      signal: new AbortController().signal, stage: 'detective', run, prompt: 'Inspect without modifying files.',
      persona: 'Inspect source names and disclose incomplete inspection.',
      childToolContribution: detectiveSearchContribution(h.ctx, run.runId, h.policy) })
      .catch((cause: unknown) => { throw new Error(JSON.stringify({ failures, requests: adapter.requests.length }), { cause }) })
    expect(result).toMatchObject({ run_id: h.runId, stage: 'detective', status: 'blocked' })
    expect(pages).toHaveLength(2)
    expect(pages[0]).toContain('range 1-2')
    expect(pages[1]).toContain('range 3-4')
    for (const page of pages) {
      expect(Array.from(page).length).toBeLessThanOrEqual(4000)
      expect(logs.some(row => text(row) === page && row.id !== parent.session.id)).toBe(true)
    }
  })

  it('shadows only its child and restores inherited definitions and guidance on disposal', async () => {
    const h = await setup()
    const globalGlob = h.ctx.tools.get('glob')
    expect(h.ctx.tools.get('glob', h.child)).not.toBe(globalGlob)
    expect(h.ctx.tools.get('glob', h.parent)).toBe(globalGlob)
    expect(h.ctx.tools.get('glob', h.sibling)).toBe(globalGlob)
    const prompt = await h.ctx.systemPrompt.assemble({ scope: h.child })
    expect(prompt.sections.find(section => section.name === 'tool:glob')?.text).toContain('saved search snapshot')
    expect((await h.ctx.systemPrompt.assemble({ scope: h.parent })).sections
      .find(section => section.name === 'tool:glob')?.text).not.toContain('saved search snapshot')
    h.dispose()
    expect(h.ctx.tools.get('glob', h.child)).toBe(globalGlob)
    expect((await h.ctx.systemPrompt.assemble({ scope: h.child })).sections
      .find(section => section.name === 'tool:glob')?.text).not.toContain('saved search snapshot')
  })

  it('pages every glob entry once from a saved snapshot after the workspace changes', async () => {
    const h = await setup({ detectiveSearch: { globMaxResults: 2 } })
    const first = await h.call('glob', { pattern: '**/*.ts' })
    expect(first.isError).toBe(false)
    let page = text(first)
    expect(page).toContain('Showing 2 of 9 entries')
    const found = entries(page)
    await writeFile(join(h.cwd, 'alpha', 'file-0.ts'), 'changed after capture\n')
    await writeFile(join(h.cwd, 'late.ts'), 'late workspace discovery\n')
    h.dispose()
    const resumed = detectiveSearchContribution(h.ctx, h.runId, resolveDetectiveSearchPolicy({
      detectiveSearchSnapshotRoot: h.snapshots, detectiveSearch: { globMaxResults: 2 },
    }))(h.child.ctx)
    try {
      while (page.includes('Truncated: true.')) {
        const result = await h.call('glob', { cursor: continuation(page) })
        expect(result.isError).toBe(false)
        page = text(result)
        expect(Array.from(page).length).toBeLessThanOrEqual(4000)
        found.push(...entries(page))
      }
    } finally { resumed() }
    expect(new Set(found).size).toBe(9)
    expect(found).toHaveLength(9)
    expect(found).not.toContain('late.ts')
    expect(found.every(path => /^[a-z]+\/file-[0-2]\.ts$/.test(path))).toBe(true)
  })

  it('keeps grep lines and filters tied to the saved source rather than current content', async () => {
    const h = await setup({ detectiveSearch: { grepMaxMatches: 1 } })
    let page = text(await h.call('grep', { pattern: 'needle', path: 'alpha', include: '*.ts' }))
    const found = entries(page)
    await writeFile(join(h.cwd, 'alpha', 'file-2.ts'), 'changed after search\n')
    while (page.includes('Truncated: true.')) {
      page = text(await h.call('grep', { cursor: continuation(page) }))
      found.push(...entries(page))
    }
    expect(found.sort()).toEqual([0, 1, 2].map(i => `alpha/file-${i}.ts:1: needle alpha ${i}`))
  })

  it('bounds the whole grep page by characters and explicitly marks cropped line previews', async () => {
    const h = await setup({ detectiveGrepMaxResultChars: 600, detectiveSearch: { grepMaxLineBytes: 100 } })
    await writeFile(join(h.cwd, 'long.ts'), Array.from({ length: 8 }, (_, i) => `needle ${i} ${'界'.repeat(180)}`).join('\n'))
    const first = await h.call('grep', { pattern: 'needle', path: 'long.ts' })
    expect(first.isError).toBe(false)
    let page = text(first)
    const found: string[] = []
    while (true) {
      expect(Array.from(page).length).toBeLessThanOrEqual(600)
      expect(page).not.toContain('�')
      found.push(...entries(page))
      if (!page.includes('Truncated: true.')) break
      page = text(await h.call('grep', { cursor: continuation(page) }))
    }
    expect(found).toHaveLength(8)
    expect(found.every(line => line.includes('line truncated'))).toBe(true)
  })

  it('exposes another subtree before taking a second entry from the first', async () => {
    const h = await setup({ detectiveSearch: { globMaxResults: 3 } })
    const result = await h.call('glob', { pattern: '**/*.ts' })
    expect(new Set(entries(text(result)).map(path => path.split('/')[0])).size).toBe(3)
  })

  it('reports empty searches without a fabricated continuation', async () => {
    const h = await setup({ detectiveSearch: { sampleOverCapGlobResults: false } })
    for (const kind of ['glob', 'grep']) {
      const result = await h.call(kind, { pattern: 'nothing-matches-this' })
      expect(result.isError).toBe(false)
      expect(text(result)).toContain('Showing 0 of 0 entries (range none)')
      expect(text(result)).not.toContain('Next page:')
    }
  })

  it('rejects invalid queries, wrong-kind cursors, foreign children and mixed continuation arguments', async () => {
    const h = await setup({ detectiveSearch: { globMaxResults: 1 } })
    const cursor = continuation(text(await h.call('glob', { pattern: '**/*.ts' })))
    for (const [kind, args, message] of [
      ['glob', {}, 'Provide a search pattern'],
      ['glob', { pattern: '**/*', include: '*.ts' }, 'glob does not accept include'],
      ['glob', { pattern: '[' }, 'pattern rejected'],
      ['glob', { cursor: 'invalid' }, 'Invalid Detective search cursor'],
      ['glob', { cursor, pattern: '**/*' }, 'accepts only cursor'],
      ['glob', { cursor: cursor.replace(/:[0-9]+$/, ':999') }, 'outside its saved result'],
      ['grep', { cursor }, 'does not match its cursor'],
    ] as const) {
      const result = await h.call(kind, args)
      expect(result.isError).toBe(true)
      expect(text(result)).toContain(message)
    }
    const other = detectiveSearchContribution(h.ctx, h.runId, h.policy)(h.sibling.ctx)
    try { expect((await h.call('glob', { cursor }, h.sibling)).isError).toBe(true) } finally { other() }
  })

  it('fails explicitly when a complete snapshot exceeds storage limits', async () => {
    const h = await setup({ detectiveSearchSnapshotMaxBytes: 1 })
    const result = await h.call('glob', { pattern: '**/*.ts' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('limit')
    expect(text(result)).not.toContain('Next page:')
  })

  it('samples an empty glob without inventing groups', async () => {
    const h = await setup()
    expect(text(await h.call('glob', { pattern: '**/*.absent' }))).toContain('Showing 0 of 0 entries')
  })

  it('rejects a producing tool invoked without its child agent', async () => {
    const h = await setup()
    h.ctx.tools.register({ ...h.ctx.tools.get('glob', h.child)!, name: 'unowned-detective-search' })
    const result = await h.ctx.tools.execute({ name: 'unowned-detective-search', arguments: { pattern: '**/*' },
      callId: CallId('unowned-search'), signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('requires its producing child agent')
  })

  it('keeps native and SDK output bounded after a policy replaces the canonical value', async () => {
    const h = await setup()
    h.ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: 'x'.repeat(5000) }))
    const result = await h.call('glob', { pattern: '**/*.ts' })
    expect(result.isError).toBe(true)
    expect('value' in result).toBe(false)
    expect(text(result)).toContain('canonical output exceeds its result limit')
    expect(Array.from(text(result)).length).toBeLessThanOrEqual(4000)
  })

  it.each([false, true])('bounds post-policy nontext feedback (oversized=%s)', async (oversized) => {
    const h = await setup()
    h.ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [
      { type: 'reasoning', text: 'x'.repeat(oversized ? 5000 : 20) },
    ] }))
    const result = await h.call('glob', { pattern: '**/*.ts' })
    expect(result.isError).toBe(true)
    expect(Array.from(text(result)).length).toBeLessThanOrEqual(4000)
    expect(text(result).includes('output exceeded its result limit')).toBe(oversized)
  })

  it('bounds oversized failure text and preserves its error status', async () => {
    const h = await setup()
    vi.spyOn(h.policy.store, 'save').mockRejectedValueOnce(new Error('x'.repeat(5000)))
    const result = await h.call('glob', { pattern: '**/*.ts' })
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('output exceeded its result limit')
    expect(text(result)).not.toContain('x'.repeat(100))
  })

  it('presents first and continuation calls without exposing snapshot content', async () => {
    const h = await setup()
    const definition = h.ctx.tools.get('glob', h.child)!
    expect(definition.presentCall?.({ pattern: '**/*.ts' })).toEqual({ card: 'generic', kind: 'search',
      title: 'Detective glob', rawInput: '**/*.ts' })
    expect(definition.presentCall?.({ cursor: 'opaque-cursor' })).toEqual({ card: 'generic', kind: 'search',
      title: 'Next glob page', rawInput: 'opaque-cursor' })
    expect(definition.presentCall?.({})).toEqual({ card: 'generic', kind: 'search', title: 'Detective glob', rawInput: undefined })
  })

  it('rolls back both definitions and prompt sections if child installation fails', async () => {
    const h = await setup()
    h.dispose()
    const inherited = h.ctx.tools.get('glob', h.child)
    const section = vi.spyOn(h.child.ctx.systemPrompt, 'section')
    section.mockImplementationOnce(() => { throw new Error('installation failed') })
    expect(() => h.install(h.child.ctx)).toThrow('installation failed')
    section.mockRestore()
    expect(h.ctx.tools.get('glob', h.child)).toBe(inherited)
    expect(h.ctx.tools.get('grep', h.child)).toBe(h.ctx.tools.get('grep'))
  })
})
