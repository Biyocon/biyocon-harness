// Keyless real-web composition: deterministic model reports, shipped Conductor
// preset, production host controller and browser HTTP answers. No API recording.
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { parseRun } from '@deepseek-ai/dsh-conductor'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-user-approval'
import { OwnerConductorAdapter } from '../../../examples/headless-agent/tests/fixtures/conductor-owner-mock.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, connectFreshWorkspaceDa } from './support.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const GOLDENS = fileURLToPath(new URL('./snapshots/conductor-owner', import.meta.url))
const MODE = webSnapshotMode()

it.each([
  { locale: 'en-US', reject: false, proposal: false },
  { locale: 'da-DK', reject: false, proposal: false },
  { locale: 'en-US', reject: true, proposal: false },
  { locale: 'en-US', reject: false, proposal: true },
])('Conductor owner card: $locale reject=$reject proposal=$proposal', async ({ locale, reject, proposal }) => {
  if (MODE === 'record') throw new Error('This scenario is keyless: use replay or refresh, never API record')
  const priorScenario = process.env['DSH_CONDUCTOR_OWNER_SCENARIO']
  process.env['DSH_CONDUCTOR_OWNER_SCENARIO'] = proposal ? 'approved' : 'analysis-web'
  const scaffold = await launchWebScaffold({ agentPresets: {
    default: 'conductor', roots: [{ path: join(ROOT, 'apps/cli/config/agent-presets'), trust: 'system' }],
  } })
  const browser = await chromium.launch()
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  try {
    scaffold.ctx.llm.registerAdapter(['conductor-installed'], new OwnerConductorAdapter())
    await scaffold.ctx.settings.update(settingsNamespace('agent-default-model'), {
      provider: 'conductor-installed', model: 'conductor-installed',
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale })
    const errors = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    if (locale === 'da-DK') await connectFreshWorkspaceDa(page, scaffold.workspaceCwd)
    else await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'workspace/probe.txt'), 'Public demonstration: read-only reporting.\n')
    await mkdir(join(scaffold.workspaceCwd, 'workspace/owner-allowed'), { recursive: true })
    if (proposal) {
      const cwd = join(scaffold.workspaceCwd, 'workspace')
      execFileSync('git', ['init', '--quiet'], { cwd })
      execFileSync('git', ['add', 'probe.txt'], { cwd })
      execFileSync('git', ['-c', 'user.name=Snapshot', '-c', 'user.email=snapshot@example.invalid', 'commit', '--quiet', '-m', 'Fixture baseline'], { cwd })
    }
    const input = page.locator('textarea:enabled').first()
    await input.fill('Review probe.txt and ask the owner for the missing choices. Do not modify files.')
    await input.press('Enter')
    const card = page.locator('[data-conductor-owner-question]')
    await card.waitFor()
    const created = events.find(event => event.type === 'conductor/owner-question-created')
    expect(created).toBeDefined()
    if (created?.type !== 'conductor/owner-question-created') throw new Error('Missing question event')
    const question = created.data.interaction.question
    const runId = created.data.runId
    const before = events.filter(event => event.type === 'conductor/child').length
    expect(await card.textContent()).toContain(runId)
    expect(await card.textContent()).toContain(question.reason)
    const continueLabel = locale === 'da-DK' ? 'Svar og fortsæt' : 'Answer and continue'
    const rejectLabel = locale === 'da-DK' ? 'Afvis' : 'Reject'
    const approveLabel = locale === 'da-DK' ? 'Godkend' : 'Approve'
    const waiting = locale === 'da-DK' ? 'Venter på ejeren' : 'Waiting for owner'
    expect(await card.textContent()).toContain(waiting)
    expect(await card.getByRole('button', { name: approveLabel, exact: true }).count()).toBe(proposal ? 1 : 0)
    expect(await card.getByRole('button', { name: continueLabel, exact: true }).isDisabled()).toBe(true)
    // A reconnect retains the durable identity and does not dispatch a child.
    await page.reload()
    await card.waitFor()
    expect(events.filter(event => event.type === 'conductor/child')).toHaveLength(before)
    expect(await card.textContent()).toContain(runId)
    const snapshot = (await captureStableAria(page, '[data-conductor-owner-question]', scaffold.workspaceCwd))
      .split(runId).join('{{runId}}')
    await compareOrRefreshGolden(join(GOLDENS, `${locale}-${proposal ? 'proposal' : 'waiting'}.expected.md`), snapshot, MODE)
    if (!proposal) {
      await card.getByRole('textbox').focus()
      await page.keyboard.press('Tab')
      expect(await card.getByRole('combobox').evaluate(element => element === document.activeElement)).toBe(true)
    }
    if (reject) {
      await card.getByRole('button', { name: rejectLabel, exact: true }).focus()
      await page.keyboard.press('Enter')
    } else {
      const prompts = question.items
      for (let i = 0; i < prompts.length; i += 1) {
        const item = prompts[i]!
        if (item.options.length !== 0) {
          const select = card.getByRole('combobox', { name: new RegExp(item.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
          await select.selectOption({ label: item.options[0]! })
        } else {
          const field = card.getByRole('textbox', { name: new RegExp(item.prompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) })
          await field.fill(proposal ? ['provider-canonical', 'No localhost bypass', 'Use the exact previewed reporting path.'][i]! : 'Documented scope')
        }
        if (i === 0 && prompts.length > 1) expect(await card.getByRole('button', { name: continueLabel, exact: true }).isDisabled()).toBe(true)
      }
      if (proposal) await card.getByRole('checkbox').check()
      const submit = card.getByRole('button', { name: proposal ? approveLabel : continueLabel, exact: true })
      await submit.focus()
      await page.keyboard.press('Enter')
    }
    await expect.poll(() => events.filter(event => event.type === (reject
      ? 'conductor/owner-terminal-rejection' : 'conductor/owner-response-recorded')).length).toBe(1)
    const receiptSelector = '[data-conductor-owner-receipt]'
    await page.locator(receiptSelector).waitFor()
    await expect.poll(() => page.locator(receiptSelector).textContent()).toContain(reject ? 'Rejected' : locale === 'da-DK' ? 'Svar accepteret' : 'Answer accepted')
    const receiptText = await page.locator(receiptSelector).textContent()
    expect(receiptText).toContain(reject ? 'Rejected' : locale === 'da-DK' ? 'Svar accepteret' : 'Answer accepted')
    await page.reload()
    await page.locator(receiptSelector).waitFor()
    await expect.poll(() => page.locator(receiptSelector).textContent()).toBe(receiptText)
    const receiptSnapshot = (await captureStableAria(page, receiptSelector, scaffold.workspaceCwd))
      .split(runId).join('{{runId}}')
    await compareOrRefreshGolden(join(GOLDENS,
      `${locale}-${proposal ? 'proposal' : reject ? 'rejected' : 'accepted'}-receipt.expected.md`), receiptSnapshot, MODE)
    if (!reject && !proposal) {
      await expect.poll(() => events.filter(event => event.type === 'conductor/checkpoint' && event.data.record !== null)
        .map(event => event.type === 'conductor/checkpoint' ? parseRun(event.data.record!).status : '').at(-1)).toBe('reported')
    }
    const facts = events.filter(event => event.type === 'conductor/owner-response-recorded'
      || event.type === 'conductor/owner-terminal-rejection')
    expect(facts.every(event => event.data.runId === runId)).toBe(true)
    expect(events.filter(event => event.type === 'approval/asked')).toEqual([])
    expect(errors.pageErrors).toEqual([])
  } finally {
    await browser.close()
    await scaffold.close()
    if (priorScenario === undefined) Reflect.deleteProperty(process.env, 'DSH_CONDUCTOR_OWNER_SCENARIO')
    else process.env['DSH_CONDUCTOR_OWNER_SCENARIO'] = priorScenario
  }
})
