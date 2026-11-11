import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { bindScopeParent, createScope, scopeOf } from '@deepseek-ai/dsh-scope'
import type { Scope } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'

const contexts: Context[] = []
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose()
})

async function setup() {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
  return ctx
}

async function scoped(ctx: Context, name: string): Promise<Scope> {
  let scope!: Scope
  await ctx.plugin(Object.assign((inner: Context) => { scope = createScope(inner, { name }) }, {
    inject: ['systemPrompt'],
  }))
  return scope
}

const schema = (name: string) => ({ name, description: name, parameters: {} })

describe('prompt section tool requirements', () => {
  it('uses explicit requirements rather than interpreting section names', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({ name: 'ordinary-advice', order: 1, text: 'Read guidance.', requiresTools: ['read'] })
    ctx.systemPrompt.section({ name: 'tool:unregistered', order: 2, text: 'Unassociated text.' })
    ctx.systemPrompt.tools(() => ({ schemas: [schema('read')] }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Read guidance.\n\nUnassociated text.')
  })

  it('suppresses a known hidden tool before invoking its text provider', async () => {
    const ctx = await setup()
    const text = vi.fn(() => 'Hidden guidance.')
    ctx.systemPrompt.section({ name: 'advice', order: 1, text, requiresTools: ['read'] })
    ctx.systemPrompt.tools(() => ({ schemas: [], knownNames: ['read'] }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
    expect(text).not.toHaveBeenCalled()
  })

  it('checks all prerequisites and recomputes visibility on each assembly', async () => {
    const ctx = await setup()
    let visible = ['search']
    ctx.systemPrompt.tools(() => ({ schemas: visible.map(schema), knownNames: ['search', 'fetch'] }))
    ctx.systemPrompt.section({ name: 'follow-up', order: 1, text: 'Fetch the result.', requiresTools: ['search', 'fetch'] })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
    visible = ['search', 'fetch']
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Fetch the result.')
    visible = ['fetch']
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
  })

  it.each([
    [[], 'must name at least one tool'],
    [[''], 'must not contain a blank tool name'],
    [['  '], 'must not contain a blank tool name'],
    [['read', 'read'], 'lists tool "read" more than once'],
    [['ghost'], 'requires unregistered tool "ghost"'],
    [['read', 'ghost'], 'requires unregistered tool "ghost"'],
  ])('rejects invalid prerequisites %j at assembly', async (requiresTools, message) => {
    const ctx = await setup()
    ctx.systemPrompt.tools(() => ({ schemas: [], knownNames: ['read'] }))
    ctx.systemPrompt.section({ name: 'advice', order: 1, text: 'Invalid.', requiresTools })
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow(`prompt section "advice" ${message}`)
  })

  it('uses capability visibility independently of collapsed wire schemas', async () => {
    const ctx = await setup()
    ctx.systemPrompt.tools(() => ({
      schemas: [schema('run_code')],
      knownNames: ['run_code'],
      capabilities: { knownNames: ['read', 'hidden'], visibleNames: ['read'] },
    }))
    ctx.systemPrompt.section({ name: 'read', order: 1, text: 'Use read.', requiresTools: ['read'] })
    ctx.systemPrompt.section({ name: 'hidden', order: 2, text: 'Hidden.', requiresTools: ['hidden'] })
    const assembly = await ctx.systemPrompt.assemble()
    expect(assembly.tools.map(tool => tool.name)).toEqual(['run_code'])
    expect(renderPrompt(assembly)).toBe('Use read.')
  })

  it('resolves shadowing before validating and filtering the effective sections', async () => {
    const ctx = await setup()
    ctx.systemPrompt.section({ name: 'advice', order: 1, text: 'Unknown.', requiresTools: ['ghost'] })
    const child = await scoped(ctx, 'child')
    child.ctx.systemPrompt.section({ name: 'advice', order: 1, text: 'Child replacement.' })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(child.ctx)! }))).toBe('Child replacement.')
    await expect(ctx.systemPrompt.assemble()).rejects.toThrow('requires unregistered tool "ghost"')
  })

  it('keeps capability visibility isolated along parent and sibling scopes', async () => {
    const ctx = await setup()
    const parent = await scoped(ctx, 'parent')
    const child = await scoped(ctx, 'child')
    const sibling = await scoped(ctx, 'sibling')
    bindScopeParent(scopeOf(child.ctx)!, scopeOf(parent.ctx)!)
    const childKey = scopeOf(child.ctx)!
    ctx.systemPrompt.tools(context => ({
      schemas: context.scope === childKey ? [] : [schema('read')],
      knownNames: ['read'],
    }))
    parent.ctx.systemPrompt.section({ name: 'advice', order: 1, text: 'Inherited advice.', requiresTools: ['read'] })
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(parent.ctx)! }))).toBe('Inherited advice.')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: childKey }))).toBe('')
    expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: scopeOf(sibling.ctx)! }))).toBe('')
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('')
  })

  it('does not restore a hidden complete section after the waterfall', async () => {
    const ctx = await setup()
    ctx.systemPrompt.tools(() => ({ schemas: [], knownNames: ['read'] }))
    const hidden = vi.fn(() => 'Hidden complete prompt.')
    ctx.systemPrompt.section({ name: 'hidden-complete', order: 1, text: hidden, complete: true, requiresTools: ['read'] })
    ctx.systemPrompt.section({ name: 'visible-complete', order: 2, text: 'Visible complete prompt.', complete: true })
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Visible complete prompt.')
    expect(hidden).not.toHaveBeenCalled()
  })

  it.each([false, true])('keeps hidden registered sections omitted after the waterfall (complete=%s)', async (complete) => {
    const ctx = await setup()
    const text = vi.fn(() => 'Hidden provider.')
    ctx.systemPrompt.tools(() => ({ schemas: [], knownNames: ['read'] }))
    ctx.systemPrompt.section({ name: 'advice', order: 1, text, complete, requiresTools: ['read'] })
    ctx.on('system-prompt/assemble', async (assembly, _context, next) => ({
      ...await next(),
      sections: [...assembly.sections, { name: 'advice', text: 'Reintroduced.' }, { name: 'independent', text: 'Independent.' }],
    }))
    expect(renderPrompt(await ctx.systemPrompt.assemble())).toBe('Independent.')
    expect(text).not.toHaveBeenCalled()
  })
})
