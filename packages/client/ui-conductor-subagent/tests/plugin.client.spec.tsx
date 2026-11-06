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
import { Content } from '../src/client/Content.tsx'
import { UnavailableRunsHeader, UnavailableRunsPanel } from '../src/client/UnavailableRuns.tsx'
afterEach(cleanup)

it.each([
  [da, 'kan ikke genoptages (format 4)', 'kan ikke genoptages (ukendt format)'],
  [en, 'cannot be resumed (format 4)', 'cannot be resumed (unknown format)'],
] as const)('shows read-only unavailable runs in the Conductor panel and session header', (dictionary, known, unknown) => {
  const props = { sessionId: 'synthetic' as SessionId, t: makeTranslate(dictionary),
    useSessions: (select: (state: unknown) => unknown) => select({ byId: { synthetic: { projectionValues: {
      conductorUnavailableRuns: { 'CON-2026-0004': { format: 4 }, 'CON-2026-0005': { format: null } },
    } } } }),
  } as unknown as Parameters<typeof UnavailableRunsPanel>[0]
  const panel = render(<UnavailableRunsPanel {...props} />)
  expect(panel.getByRole('region').textContent).toContain(known)
  expect(panel.getByRole('region').textContent).toContain(unknown)
  expect(panel.container.querySelector('button')).toBeNull()
  const header = render(<UnavailableRunsHeader {...props} />)
  expect(header.getByRole('status').textContent).toContain(known)
  expect(header.getByRole('status').textContent).toContain(unknown)
})

it('shows no unavailable-run chrome when the session has no matching projection', () => {
  const props = { sessionId: 'synthetic' as SessionId, t: makeTranslate(en),
    useSessions: (select: (state: unknown) => unknown) => select({ byId: {} }),
  } as unknown as Parameters<typeof UnavailableRunsPanel>[0]
  expect(render(<UnavailableRunsPanel {...props} />).container.textContent).toBe('')
  expect(render(<UnavailableRunsHeader {...props} />).container.textContent).toBe('')
})

it.each([da, en])('renders validated findings and all model text literally', (dictionary) => {
  const text = '<script>alert("finding")</script> [external](https://example.invalid)'
  const child: ConductorChild = { childId: 'critic' as SessionId, runId: ConductorRunId('CON-2026-0028'),
    role: 'devils-advocate', mode: 'critic', attempt: 2, criticAttempt: 1, historyOffset: 1, status: 'completed',
    gate: { id: 'C', decision: 'escalate', reworks: 2, limit: 2, challengeConclusion: 'does_not_hold',
      challenge: { hash: 'a'.repeat(64), result: { run_id: ConductorRunId('CON-2026-0028'), purpose: 'analysis',
        candidate_hash: 'b'.repeat(64), candidate_version: 'v1', material_ids: [], critic_child_id: 'critic',
        critic_attempt: 1, conclusion: 'does_not_hold', defect: 'report', summary: `Summary: ${text}`, findings: (['minor', 'major', 'critical'] as const).map(severity => ({
          id: severity, severity, claim: `${severity} claim: ${text}`, rationale: `${severity} rationale: ${text}`, material_ids: [],
        })) } } } }
  const props = { childId: child.childId, parent: undefined, nameId: 'name', detailId: 'detail',
    nameClass: '', detailClass: '', matched: child, t: makeTranslate(dictionary) } as Parameters<typeof Content>[0]
  const view = render(<div role="treeitem" aria-labelledby="name detail"><Content {...props} /></div>)
  expect(view.container.querySelectorAll('script, a')).toHaveLength(0)
  expect(view.container.textContent?.split(text)).toHaveLength(8)
  for (const severity of ['minor', 'major', 'critical'] as const) {
    expect(view.getByText(dictionary[`severity.${severity}`])).toBeDefined()
    expect(view.getByText(`${severity} claim: ${text}`, { exact: true })).toBeDefined()
    expect(view.getByText(`${dictionary['finding.rationale']}: ${severity} rationale: ${text}`, { exact: true })).toBeDefined()
  }
  expect(view.getByRole('treeitem', { name: name => name.includes(`Summary: ${text}`) && name.includes(`minor rationale: ${text}`) })).toBeDefined()
  expect(view.getByRole('list')).toBeDefined()
  expect(view.getByText(dictionary['challenge.findings'], { exact: true })).toBeDefined()
  expect(view.container.textContent).toContain(dictionary['gate.escalate'])
  const pending = { ...child, status: 'running' as const }
  delete pending.gate
  view.rerender(<Content {...props} matched={pending} />)
  expect(view.container.textContent).toContain(dictionary['challenge.pending'])
  expect(view.container.textContent).not.toContain(text)
  view.rerender(<Content {...props} matched={{ ...child, gate: { id: 'C', decision: 'pass', reworks: 0, limit: 2,
    challengeConclusion: 'holds', challenge: { hash: 'a'.repeat(64), result: { run_id: ConductorRunId('CON-2026-0028'), purpose: 'analysis',
      candidate_hash: 'b'.repeat(64), candidate_version: 'v1', material_ids: [], critic_child_id: 'critic',
      critic_attempt: 1, conclusion: 'holds', summary: `Summary: ${text}`, findings: [] } } } }} />)
  expect(view.queryByRole('list')).toBeNull()
  expect(view.container.textContent).toContain(dictionary['challenge.holds'])
  view.rerender(<Content {...props} matched={{ ...child, gate: { id: 'C', decision: 'rework', reworks: 1, limit: 2 } }} />)
  expect(view.container.textContent).toContain(dictionary['challenge.invalid'])
  view.rerender(<Content {...props} matched={{ ...pending, status: 'failed' }} />)
  expect(view.container.textContent).not.toContain(dictionary['challenge.pending'])
})

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
