// Real web composition with a keyless model adapter; the host validates every challenge.
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { expect, it } from 'vitest'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-conductor/child-types'
import { InstalledConductorAdapter } from '../../../examples/headless-agent/tests/fixtures/conductor-installed-mock.ts'
import { captureStableAria, compareOrRefreshGolden, launchWebScaffold, webSnapshotMode, watchConsole } from './scaffold.ts'
import { connectFreshWorkspace, connectFreshWorkspaceDa } from './support.ts'

const ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const GOLDENS = fileURLToPath(new URL('./snapshots/conductor-critic/', import.meta.url))
const MODE = webSnapshotMode()
const LITERAL = '<script>alert("finding")</script> [external](https://example.invalid)'

it.each([
  { locale: 'en-US', conclusion: 'holds' }, { locale: 'da-DK', conclusion: 'holds' },
  { locale: 'en-US', conclusion: 'escalated' }, { locale: 'da-DK', conclusion: 'escalated' },
  { locale: 'en-US', conclusion: 'invalid' }, { locale: 'da-DK', conclusion: 'invalid' },
])('Conductor critic: $locale $conclusion', async ({ locale, conclusion }) => {
  const priorScenario = process.env['DSH_CONDUCTOR_INTAKE_SCENARIO']
  process.env['DSH_CONDUCTOR_INTAKE_SCENARIO'] = `critic-web-${conclusion}`
  let release = () => {}
  const pending = new Promise<void>((resolve) => { release = resolve })
  let releaseFinalCatalog = () => {}
  const finalCatalogPending = new Promise<void>((resolve) => { releaseFinalCatalog = resolve })
  let finalCatalogSeen = false
  let drainCatalog = async () => {}
  class PausedCritic extends InstalledConductorAdapter {
    override async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
      if (options.messages.some(message => message.content.some(block => block.type === 'text'
        && block.text.startsWith('{"identity":')))) await pending
      yield* super.stream(options)
    }
  }
  const scaffold = await launchWebScaffold({ agentPresets: {
    default: 'conductor', roots: [{ path: join(ROOT, 'packages/conductor/conductor-host-rc7/presets'), trust: 'system' }],
  } })
  const browser = await chromium.launch()
  const events: SessionEvent[] = []
  scaffold.ctx.on('session/event', (_session, event) => { events.push(event) })
  try {
    scaffold.ctx.llm.registerAdapter(['conductor-installed'], new PausedCritic())
    await scaffold.ctx.settings.update(settingsNamespace('agent-default-model'), {
      provider: 'conductor-installed', model: 'conductor-installed',
    })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale })
    const errors = watchConsole(page)
    await page.goto(scaffold.baseUrl)
    if (locale === 'da-DK') await connectFreshWorkspaceDa(page, scaffold.workspaceCwd)
    else await connectFreshWorkspace(page, scaffold.workspaceCwd)
    await writeFile(join(scaffold.workspaceCwd, 'workspace/plan.md'), 'Public plan: compare a small pilot with a full rollout.\n')
    const input = page.locator('textarea:enabled').first()
    await input.fill('Analyze plan.md and report findings without modifying files.')
    await input.press('Enter')
    await expect.poll(() => events.some(event => event.type === 'conductor/child' && event.data.mode === 'critic')).toBe(true)
    const catalog = page.locator('button[aria-haspopup="tree"]')
    await expect.poll(() => catalog.textContent()).toMatch(/^2 /)
    await catalog.click()
    const tree = page.getByRole('tree', { name: locale === 'da-DK' ? 'Underagentsessioner' : 'Subagent sessions', exact: true })
    const pendingText = locale === 'da-DK' ? 'kritik afventer' : 'challenge pending'
    await tree.getByRole('treeitem', { name: new RegExp(pendingText) }).waitFor()
    await expect.poll(() => tree.textContent()).toContain(pendingText)
    expect(await tree.textContent()).toContain(locale === 'da-DK' ? 'producent' : 'producer')
    expect(await tree.textContent()).toContain(locale === 'da-DK' ? 'kritiker' : 'critic')
    const selector = '[role="tree"][aria-label="' + (locale === 'da-DK' ? 'Underagentsessioner' : 'Subagent sessions') + '"]'
    await compareOrRefreshGolden(join(GOLDENS, `${locale}-${conclusion}-pending.expected.md`),
      await captureStableAria(page, selector, scaffold.workspaceCwd), MODE)
    if (conclusion === 'holds') {
      // Delay a real response, leaving the terminal host checkpoint ahead of the browser catalog.
      await page.route('**/api/subagent.list', async (route) => {
        const response = await route.fetch()
        const body = await response.json() as {
          result: { ok: true; value: { entries: { id: string }[] } } | { ok: false }
        }
        const arbiter = events.find(event => event.type === 'conductor/child' && event.data.role === 'arbiter')
        if (arbiter?.type === 'conductor/child' && body.result.ok
          && body.result.value.entries.some(entry => entry.id === arbiter.data.childId)) {
          finalCatalogSeen = true
          await finalCatalogPending
        }
        await route.fulfill({ response })
      })
      drainCatalog = () => page.unrouteAll({ behavior: 'wait' })
    }
    release()
    const finding = page.locator('[data-conductor-challenge]')
    await finding.waitFor()
    expect(await finding.locator('script, a').count()).toBe(0)
    expect((await finding.textContent())?.split(LITERAL)).toHaveLength(4)
    expect(await finding.getByText(`Claim: ${LITERAL}`, { exact: true }).count()).toBe(1)
    expect(await finding.getByText(`${locale === 'da-DK' ? 'Begrundelse' : 'Rationale'}: Rationale: ${LITERAL}`, { exact: true }).count()).toBe(1)
    expect(await tree.getByRole('treeitem', { name: new RegExp('Summary: <script>') }).count()).toBe(1)
    expect(await finding.textContent()).toContain(conclusion !== 'escalated'
      ? locale === 'da-DK' ? 'Mindre alvorlig' : 'Minor' : locale === 'da-DK' ? 'Kritisk' : 'Critical')
    const finalText = conclusion === 'holds' ? locale === 'da-DK' ? 'kritik holder' : 'challenge holds'
      : conclusion === 'escalated' ? locale === 'da-DK' ? 'eskaleret' : 'escalated'
        : locale === 'da-DK' ? 'kritik ikke valideret' : 'challenge not validated'
    await expect.poll(() => tree.textContent()).toContain(finalText)
    await expect.poll(() => events.filter(event => event.type === 'conductor/checkpoint' && event.data.record !== null)
      .map(event => event.type === 'conductor/checkpoint' ? JSON.parse(event.data.record!) as { status: string } : null)
      .at(-1)?.status).toBe(conclusion === 'escalated' ? 'escalated' : 'reported')
    if (conclusion === 'holds') {
      await expect.poll(() => finalCatalogSeen).toBe(true)
      expect(await tree.getByRole('treeitem', { name: /^The Arbiter/ }).count()).toBe(0)
      expect(await captureStableAria(page, selector, scaffold.workspaceCwd)).not.toContain('The Arbiter')
      releaseFinalCatalog()
    }
    // The host checkpoint can precede the final child's WebSocket projection.
    if (conclusion !== 'escalated') {
      await tree.getByRole('treeitem', {
        name: /^The Arbiter · (?:attempt 1 completed · Gate G: pass|forsøg 1 færdig · Gate G: bestået) · /,
      }).waitFor()
    }
    await compareOrRefreshGolden(join(GOLDENS, `${locale}-${conclusion}-settled.expected.md`),
      await captureStableAria(page, selector, scaffold.workspaceCwd), MODE)
    await page.reload()
    await page.locator('button[aria-haspopup="tree"]').click()
    await finding.waitFor()
    expect((await finding.textContent())?.split(LITERAL)).toHaveLength(4)
    expect(await finding.getByText(`Claim: ${LITERAL}`, { exact: true }).count()).toBe(1)
    expect(await finding.getByText(`${locale === 'da-DK' ? 'Begrundelse' : 'Rationale'}: Rationale: ${LITERAL}`, { exact: true }).count()).toBe(1)
    expect(await tree.getByRole('treeitem', { name: new RegExp('Summary: <script>') }).count()).toBe(1)
    expect(await finding.locator('script, a').count()).toBe(0)
    expect(errors.pageErrors).toEqual([])
  } finally {
    release()
    releaseFinalCatalog()
    await drainCatalog()
    await browser.close()
    await scaffold.close()
    if (priorScenario === undefined) Reflect.deleteProperty(process.env, 'DSH_CONDUCTOR_INTAKE_SCENARIO')
    else process.env['DSH_CONDUCTOR_INTAKE_SCENARIO'] = priorScenario
  }
})
