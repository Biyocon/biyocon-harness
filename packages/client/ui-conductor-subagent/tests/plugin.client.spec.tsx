// @vitest-environment jsdom
import { createElement, type ComponentType } from 'react'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import { render, cleanup } from '@testing-library/react'
import { Context } from '@deepseek-ai/cordis'
import { SlotRegistry, type SessionId, type SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor/types'
import { afterEach, expect, it, vi } from 'vitest'
import * as host from '../src/index.ts'
import { apply, inject } from '../src/client/index.ts'
import { da, en } from '../src/client/locales.ts'
afterEach(cleanup)

it.each([da, en])('elects the exact child and frees its slot on disposal', async (dictionary) => {
  const ctx = new Context()
  host.apply()
  await ctx.plugin(SlotRegistry)
  const removeLocale = vi.fn()
  ctx.provide('locale', { register: () => removeLocale } as never)
  ctx.slots.register({ name: 'root', children: { 'subagent.catalog.content': { kind: 'chain', scope: 'root' } } } as never, () => null)
  const fiber = await ctx.plugin({ inject, apply })
  const entry = ctx.slots.entries('subagent.catalog.content')[0]!
  const childId = 'second' as SessionId
  const parent = { projectionValues: { conductorChildren: {
    [childId]: { childId, runId: ConductorRunId('CON-2026-0028'), role: 'strategist', attempt: 2, historyOffset: 2, status: 'running' },
  } } } as unknown as SessionSummary
  const owner = { parent, childId, nameId: 'name', detailId: 'detail', nameClass: '', detailClass: '' }
  const select = entry.select as (data: typeof owner) => ConductorChild | null
  const matched = select(owner)
  expect(select({ ...owner, childId: 'ordinary' as SessionId })).toBeNull()
  expect(select({ ...owner, parent: undefined } as unknown as typeof owner)).toBeNull()
  const view = render(createElement(entry.component as ComponentType<Record<string, unknown>>,
    { ...owner, matched, t: makeTranslate(dictionary) }))
  expect(view.container.textContent).toContain(dictionary === da ? 'Strategist · forsøg 2' : 'Strategist · attempt 2')
  expect(view.container.textContent).not.toContain('Gate B')
  expect(view.container.textContent).toContain(dictionary === da ? 'kører' : 'running')
  await fiber.dispose()
  expect(ctx.slots.entries('subagent.catalog.content')).toHaveLength(0)
  expect(removeLocale).toHaveBeenCalledOnce()
})
