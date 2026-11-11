import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { admitIntake, captureIntakeMaterial } from '@deepseek-ai/dsh-conductor'
import { CallId } from '@deepseek-ai/dsh-llm'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { analysisToolGuard, DETECTIVE_CAPTURE_READ_TOOL, detectiveCaptureToolGuard, READ_TOOLS } from '../src/capability.ts'
import { prepareDetectiveCapture, resolveDetectiveCapturePolicy } from '../src/detective-capture.ts'
import type { DetectiveCaptureSettings } from '../src/detective-capture.ts'

const contexts: Context[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

function admission(content = 'First captured line.\r\nSecond line: 界 😀.\rLast adverse finding.\n') {
  return admitIntake({ purpose: 'analysis', entry: 'detective', deliverable: 'answer', rationale: 'Review the saved file.' }, [
    captureIntakeMaterial('current-request', 'Review source.txt.', { sessionId: SessionId('capture-parent'), eventIndex: 1 }),
    captureIntakeMaterial('source.txt', content),
  ])
}

function text(result: { content: ContentBlock[] }): string {
  return result.content.map(block => block.type === 'text' ? block.text : JSON.stringify(block)).join('')
}

async function setup(settings: DetectiveCaptureSettings = {}, admitted = admission()) {
  const ctx = new Context()
  contexts.push(ctx)
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  const child = ctx.agentLoop.create(SessionId('capture-child'), { provider: 'unused', model: 'unused' })
  const sibling = ctx.agentLoop.create(SessionId('other-role'), { provider: 'unused', model: 'unused' })
  const searchDisposed = vi.fn()
  const search = vi.fn(() => searchDisposed)
  const prepared = prepareDetectiveCapture(admitted, resolveDetectiveCapturePolicy(settings), search)
  const dispose = prepared.childToolContribution(child.ctx)
  const material = admitted.materials[1]!
  const args = { material_id: material.id, sha256: material.sha256, selector: material.selector }
  let calls = 0
  const call = (extra: Record<string, unknown> = {}, agent = child) => ctx.tools.execute({
    name: DETECTIVE_CAPTURE_READ_TOOL, arguments: { ...args, ...extra }, agent,
    signal: new AbortController().signal, callId: CallId(`capture-${++calls}`),
  })
  return { ctx, child, sibling, prepared, dispose, args, call, searchDisposed }
}

describe('Detective saved-source capture', () => {
  it('validates independent deployment limits', () => {
    expect(resolveDetectiveCapturePolicy({})).toEqual({ maxChars: 4000, maxLines: 200 })
    for (const field of ['detectiveCaptureMaxResultChars', 'detectiveCaptureMaxLines'] as const) {
      for (const value of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
        expect(() => resolveDetectiveCapturePolicy({ [field]: value })).toThrow()
      }
    }
    expect(() => resolveDetectiveCapturePolicy({ detectiveCaptureMaxResultChars: 511 })).toThrow()
    expect(resolveDetectiveCapturePolicy({ detectiveCaptureMaxResultChars: 512, detectiveCaptureMaxLines: 1 }))
      .toEqual({ maxChars: 512, maxLines: 1 })
  })

  it('indexes files in admitted order, keeps the request and does not change the durable capture', async () => {
    const admitted = admission()
    const original = JSON.stringify(admitted)
    const h = await setup({}, admitted)
    expect(h.prepared.admission.materials[0]).toEqual(admitted.materials[0])
    const { content, ...identity } = admitted.materials[1]!
    expect(h.prepared.admission.materials[1]).toEqual({ ...identity, byte_length: Buffer.byteLength(content), line_count: 3 })
    expect(JSON.stringify(h.prepared.admission)).not.toContain('Last adverse finding.')
    expect(JSON.stringify(admitted)).toBe(original)
    expect(JSON.parse(text(await h.call()))).toMatchObject({ start_line: 1, end_line: 3, total_lines: 3,
      lines: ['First captured line.', 'Second line: 界 😀.', 'Last adverse finding.'], truncated: false, next_start_line: null })
  })

  it('pages exact captured lines, including a later adverse finding, without rereading mutable admission', async () => {
    const admitted = admission()
    const h = await setup({ detectiveCaptureMaxLines: 2 }, admitted)
    admitted.materials[1]!.content = 'REPLACED_AFTER_DISPATCH'
    expect(JSON.parse(text(await h.call()))).toMatchObject({ end_line: 2, truncated: true, next_start_line: 3 })
    const last = await h.call({ start_line: 3, line_count: 1 })
    expect(last.isError).toBe(false)
    expect(JSON.parse(text(last))).toMatchObject({ start_line: 3, end_line: 3, truncated: false,
      lines: ['Last adverse finding.'], next_start_line: null })
    expect(text(last)).not.toContain('REPLACED_AFTER_DISPATCH')
  })

  it('bounds whole JSON pages by Unicode characters and makes forward progress', async () => {
    const h = await setup({ detectiveCaptureMaxResultChars: 512 }, admission(`${'界😀'.repeat(30)}\n`.repeat(9)))
    let start = 1
    const lines: string[] = []
    while (true) {
      const result = await h.call({ start_line: start })
      expect(result.isError).toBe(false)
      expect(Array.from(text(result)).length).toBeLessThanOrEqual(512)
      const page = JSON.parse(text(result)) as { lines: string[]; next_start_line: number | null }
      lines.push(...page.lines)
      if (page.next_start_line === null) break
      expect(page.next_start_line).toBeGreaterThan(start)
      start = page.next_start_line
    }
    expect(lines).toEqual(Array<string>(9).fill('界😀'.repeat(30)))
  })

  it.each([
    [{ material_id: 'unknown' }, 'Unknown captured file'],
    [{ sha256: '0'.repeat(64) }, 'identity or hash mismatch'],
    [{ selector: 'different.txt' }, 'identity or hash mismatch'],
    [{ start_line: 0 }, 'positive integer'],
    [{ start_line: 1.5 }, 'positive integer'],
    [{ start_line: Number.MAX_SAFE_INTEGER + 1 }, 'positive integer'],
    [{ line_count: 0 }, 'positive integer'],
    [{ line_count: 1.5 }, 'positive integer'],
    [{ line_count: 201 }, 'positive integer'],
    [{ start_line: 4 }, 'outside the saved file'],
  ])('rejects invalid saved-source request %j', async (args, message) => {
    const h = await setup()
    const result = await h.call(args)
    expect(result.isError).toBe(true)
    expect(text(result)).toContain(message)
    expect(text(result)).not.toContain('First captured line.')
  })

  it.each(['id', 'sha256', 'content', 'kind'] as const)('rechecks a corrupt durable %s', async (field) => {
    const admitted = admission()
    const file = admitted.materials[1]!
    const corrupted = { ...file, [field]: field === 'kind' ? 'current-request' : 'corrupt' }
    const h = await setup({}, { ...admitted, materials: [admitted.materials[0], corrupted] })
    const result = await h.call()
    expect(result.isError).toBe(true)
    expect(text(result)).toMatch(/Unknown captured file|identity or hash mismatch/)
  })

  it('rejects a current-request id and a complete line that cannot fit', async () => {
    const h = await setup({ detectiveCaptureMaxResultChars: 512 }, admission('界'.repeat(1000)))
    const request = h.prepared.admission.materials[0]!
    expect(text(await h.call({ material_id: request.id }))).toContain('Unknown captured file')
    const result = await h.call()
    expect(result.isError).toBe(true)
    expect(text(result)).toContain('No source text was returned')
    expect(Array.from(text(result)).length).toBeLessThanOrEqual(512)
  })

  it('keeps the tool and guidance child-scoped and removes both on disposal', async () => {
    const h = await setup()
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL)).toBeUndefined()
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.sibling)).toBeUndefined()
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)).toBeDefined()
    expect((await h.call({}, h.sibling)).isError).toBe(true)
    const guidance = async (scope: typeof h.child) => (await h.ctx.systemPrompt.assemble({ scope })).sections
      .find(section => section.name === `tool:${DETECTIVE_CAPTURE_READ_TOOL}`)?.text
    expect(await guidance(h.child)).toContain('Cite only inspected lines')
    expect(await guidance(h.sibling)).toBeUndefined()
    h.dispose()
    expect(h.searchDisposed).toHaveBeenCalledOnce()
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)).toBeUndefined()
    expect(await guidance(h.child)).toBeUndefined()
  })

  it('unloads the complete trusted contribution with its owning child fiber', async () => {
    const h = await setup()
    h.dispose()
    h.child.ctx.effect(() => h.prepared.childToolContribution(h.child.ctx))
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)).toBeDefined()
    await h.child.ctx.fiber.dispose()
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)).toBeUndefined()
    expect(h.searchDisposed).toHaveBeenCalledTimes(2)
  })

  it('returns a whole escaped line at the exact complete-result character limit', async () => {
    const admitted = admission(`${'quoted " and slash \\ '.repeat(18)}\n`)
    const first = await setup({}, admitted)
    const complete = text(await first.call())
    const limit = Array.from(complete).length
    expect(limit).toBeGreaterThan(512)
    const exact = await setup({ detectiveCaptureMaxResultChars: limit }, admitted)
    expect(text(await exact.call())).toBe(complete)
    const short = await setup({ detectiveCaptureMaxResultChars: limit - 1 }, admitted)
    expect((await short.call()).isError).toBe(true)
  })

  it('rolls back the search and capture tool when guidance installation fails', async () => {
    const h = await setup()
    h.dispose()
    vi.spyOn(h.child.ctx.systemPrompt, 'section').mockImplementationOnce(() => { throw new Error('section failed') })
    expect(() => h.prepared.childToolContribution(h.child.ctx)).toThrow('section failed')
    expect(h.searchDisposed).toHaveBeenCalledTimes(2)
    expect(h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)).toBeUndefined()
  })

  it('uses pure file locations from call arguments', async () => {
    const h = await setup()
    const tool = h.ctx.tools.get(DETECTIVE_CAPTURE_READ_TOOL, h.child)!
    expect(tool.isConcurrencySafe?.({ ...h.args })).toBe(true)
    expect(tool.presentCall?.(h.args)).toMatchObject({ card: 'generic', kind: 'read', locations: [{ path: 'source.txt', line: 1 }] })
    expect(tool.presentCall?.({ ...h.args, start_line: 3 })).toMatchObject({ locations: [{ path: 'source.txt', line: 3 }] })
  })

  it('does not expand other roles or permit writes through the Detective guard', async () => {
    const h = await setup()
    h.child.ctx.tools.guard(detectiveCaptureToolGuard)
    h.sibling.ctx.tools.guard(analysisToolGuard)
    const execute = { name: DETECTIVE_CAPTURE_READ_TOOL, arguments: h.args, agent: h.child,
      signal: new AbortController().signal, callId: CallId('capture-guard') }
    expect((await h.ctx.tools.execute(execute)).isError).toBe(false)
    expect(READ_TOOLS).toEqual(['read', 'read_image', 'grep', 'glob'])
    expect(analysisToolGuard({ name: execute.name } as never)).toContain('read-only')
    expect(detectiveCaptureToolGuard({ name: 'read' } as never)).toBeUndefined()
    expect(detectiveCaptureToolGuard({ name: 'write' } as never)).toContain('read-only')
  })

  it('bounds a post-policy replacement of canonical output', async () => {
    const h = await setup()
    h.ctx.on('tools/post-execute', async () => ({ kind: 'accept', value: 'x'.repeat(5000) }))
    const result = await h.call()
    expect(result.isError).toBe(true)
    expect('value' in result).toBe(false)
    expect(text(result)).toContain('canonical output exceeds')
  })

  it.each([false, true])('bounds nontext post-policy feedback (oversized=%s)', async (oversized) => {
    const h = await setup()
    h.ctx.on('tools/post-execute', async () => ({ kind: 'block', feedback: [
      { type: 'reasoning', text: 'x'.repeat(oversized ? 5000 : 20) },
    ] }))
    const result = await h.call()
    expect(result.isError).toBe(true)
    expect(Array.from(text(result)).length).toBeLessThanOrEqual(4000)
    expect(text(result).includes('output exceeded its result limit')).toBe(oversized)
  })
})
