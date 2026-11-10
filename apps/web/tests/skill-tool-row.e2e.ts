// Web e2e scenario: the real skill-load recording, seeded cold through the
// persistence seam, renders through ui-skill's keyed toolview without a model
// call. The disclosure proves replay-stable naming and exact durable output.
import { readFile } from 'node:fs/promises'
import { sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { parseSessionLog } from '@deepseek-ai/dsh-llm-replay'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden, fixtureUserPrompts,
  launchWebScaffold, realizeSeedFixture, seedSession, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const FIXTURE = fileURLToPath(new URL('../../../examples/acp-agent/tests/snapshots/skill-load/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/skill-tool-row', import.meta.url))
const UI_EXPECTED = fileURLToPath(new URL('./snapshots/skill-tool-row/ui.expected.md', import.meta.url))
const MODE = webSnapshotMode()
const SEED_ID = 'skill-tool-row-web-e2e'
const PROMPT = 'Load the snapshot-skill skill with the skill tool, then reply DONE.'

describe.skipIf(MODE === 'record')('web e2e: dedicated Skill tool row', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>
  let displayCwd: string
  let recordedInstructions: string

  beforeAll(async () => {
    const fixture = await readFile(FIXTURE, 'utf8')
    expect(fixtureUserPrompts(fixture)).toEqual([PROMPT])
    scaffold = await launchWebScaffold({})
    displayCwd = scaffold.workspaceCwd.split(sep).join('/')
    const nativeHeader = realizeSeedFixture(scaffold, fixture, SEED_ID).split('\n', 1)[0]!
    const portableEvents = realizeSeedFixture({ workspaceCwd: displayCwd }, fixture, SEED_ID).split('\n').slice(1)
    // Keep host ownership native; the recorded display paths use the same
    // forward-slash spelling on every platform before ARIA quotes the text.
    const seed = [nativeHeader, ...portableEvents].join('\n')
    const result = parseSessionLog(seed).find(event => event.type === 'tool/result')
    if (result?.type !== 'tool/result') throw new Error('skill fixture has no tool result')
    const block = result.data.message.content.find(part => part.type === 'tool-result')
    if (block?.type !== 'tool-result') throw new Error('skill fixture has no result content')
    recordedInstructions = block.content.filter(part => part.type === 'text').map(part => part.text).join('\n')
    await seedSession(scaffold, seed, SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })

    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.locator('[data-tool="skill"]').waitFor({ timeout: 15_000 })
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('expands the loaded skill to its exact recorded instructions', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-skill-tool-row'))
    const call = page.locator('[data-tool="skill"]')
    const row = call.getByRole('button', { name: 'Skill snapshot-skill' })
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('false')
    expect(await call.getByText('snapshot-skill', { exact: true }).count()).toBe(1)

    await row.click()
    await expect.poll(() => row.getAttribute('aria-expanded')).toBe('true')
    await call.getByText('Instructions', { exact: true }).waitFor()
    const output = call.locator('pre')
    await output.waitFor()
    expect(await output.textContent()).toContain('<skill_content name="snapshot-skill">')
    expect(await output.textContent()).toContain('Follow these snapshot-only instructions.')
    expect(await output.textContent()).toBe(recordedInstructions)
    expect(recordedInstructions).toContain(`Base directory for this skill: ${displayCwd}/.dsh/skills/snapshot-skill`)
    expect(await output.evaluate(element => getComputedStyle(element.parentElement!).maxHeight)).toBe('260px')

    const snapshot = (await captureStableAria(page, '[class*="centerCol"]', displayCwd))
      .replace(/\b\d{1,2}\/\d{1,2}(?= \{\{clock\}\})/g, '{{date}}')
      .split(SEED_ID).join('{{seededId}}')
    await compareOrRefreshGolden(UI_EXPECTED, snapshot, MODE)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('keeps its snapshot inventory closed', async () => {
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  })
})
