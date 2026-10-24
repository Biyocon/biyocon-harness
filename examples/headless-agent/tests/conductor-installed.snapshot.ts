import { cp, copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeSessionLog, scrubRequestHeaders } from '@deepseek-ai/dsh-acp-snapshot'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleMode, runLoaderSmoke } from '@deepseek-ai/dsh-loader-smoke'
import type { SessionEvent, SessionHeader } from '@deepseek-ai/dsh-session'
import { beforeAll, describe, expect, it } from 'vitest'
import { generateConductorSkills } from '../../../apps/cli/scripts/generate-conductor-skills.ts'
import { canonicalSessionFixture } from '../../../scripts/session-fixture-layout.ts'

const root = fileURLToPath(new URL('../../../', import.meta.url))
const configPath = join(root, 'examples/headless-agent/conductor-installed.cordis.snapshot.yml')
const driver = join(root, 'examples/headless-agent/tests/fixtures/conductor-installed-driver.ts')
const shipped = join(root, 'apps/cli/config/agent-presets/conductor')
const expectedDirectory = fileURLToPath(new URL('./snapshots/conductor-installed/', import.meta.url))

describe('installed Conductor through the headless example', () => {
  beforeAll(async () => {
    // Source replay prepares only resources; lib replay verifies the prior CLI build's assets.
    if (resolveExampleMode() === 'src') await generateConductorSkills()
  })
  it('starts Detective in an external workspace without accepting workspace protocol overrides', async () => {
    const result = await runLoaderSmoke({
      label: 'installed Conductor external-workspace snapshot',
      tempDirPrefix: 'conductor-installed-snapshot-',
      binScript: driver, libBinScript: driver, configPath,
      binArgs: [configPath, 'Use Conductor to inspect probe.txt and report its intentional blocker.'],
      tsconfigPath: join(root, 'tsconfig.json'),
      env: { DSH_SNAPSHOT: 'replay', DSH_TELEMETRY_DISABLED: '1' },
      prepare: async (cwd) => {
        expect(relative(root, cwd)).toMatch(/^\.\./)
        await mkdir(join(cwd, '.git'))
        await cp(shipped, join(cwd, 'installed-presets/conductor'), { recursive: true })
        await writeFile(join(cwd, 'probe.txt'), 'DETECTIVE_EXTERNAL_OK\n')
        const override = join(cwd, '.agents/skills/conductor-specialist')
        await mkdir(override, { recursive: true })
        await writeFile(join(override, 'SKILL.md'), '---\nname: conductor-specialist\ndescription: Project override\n---\nWORKSPACE_PROTOCOL_MUST_NOT_RUN\n')
      },
      inspect: async (cwd) => {
        const files = (await readdir(join(cwd, '.sessions'), { recursive: true })).filter(file => file.endsWith('.jsonl'))
        const logs = await Promise.all(files.map(file => readFile(join(cwd, '.sessions', file), 'utf8')))
        expect(logs, logs.flatMap(log => log.split('\n').filter(line => /tool\/result|conductor\/checkpoint/.test(line))).join('\n')).toHaveLength(2)
        const decoded = logs.map((log) => {
          const [first, ...events] = log.trim().split('\n')
          return { log, header: JSON.parse(first!) as SessionHeader, events: events.map(line => JSON.parse(line) as SessionEvent) }
        })
        const parent = decoded.find(({ header }) => header.parentSession === undefined)!
        const child = decoded.find(({ header }) => header.parentSession !== undefined)!
        expect(child.header.cwd).toBe(cwd)
        expect(child.header.parentSession).toBe(parent.header.id)
        const childText = JSON.stringify(child.events)
        expect(childText).toContain('# Detective')
        expect(childText).toContain('DETECTIVE_EXTERNAL_OK')
        expect(childText).not.toContain('WORKSPACE_PROTOCOL_MUST_NOT_RUN')
        expect(child.events.filter(row => row.type === 'tool/call').map(row => row.data.name)).toEqual(['read', 'structured_output'])
        const headers = parent.events.filter(row => row.type === 'request/header')
        expect(JSON.stringify(headers)).toContain('Never replace a failed Conductor run')
        expect(parent.events.filter(row => row.type === 'tool/call').map(row => row.data.name)).toEqual(['conductor'])
        const checkpoint = parent.events.filter(row => row.type === 'conductor/checkpoint').at(-1)!
        expect(checkpoint.data.record).not.toBeNull()
        expect(JSON.parse(checkpoint.data.record!), child.log.split('\n').filter(line => /tool\/result|error/.test(line)).join('\n')).toMatchObject({
          status: 'escalated',
          specialistReports: [{ stage: 'detective', status: 'blocked', summary: 'Detective read the external workspace.' }],
        })
        const context = { cwd, sessionIds: [parent.header.id, child.header.id] }
        for (const [name, { log }] of [['parent', parent], ['detective', child]] as const) {
          const normalized = scrubRequestHeaders(normalizeSessionLog(log, context))
            .replace(/CON-\d{4}-\d{4}/g, '{{runId}}')
            .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '{{isoTime}}')
          const snapshot = canonicalSessionFixture(normalized, name)!
          const expectedPath = join(expectedDirectory, `${name}.expected.jsonl`)
          if (process.env.DSH_SNAPSHOT === 'refresh') {
            await mkdir(expectedDirectory, { recursive: true })
            await writeFile(expectedPath, snapshot)
          }
          expect(snapshot, name).toBe(await readFile(expectedPath, 'utf8'))
        }
      },
    })
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('Conductor stopped after Detective: DETECTIVE_EXTERNAL_OK.')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('rejects a shipped preset missing its installed roles before a model request', async () => {
    const result = await runLoaderSmoke({
      label: 'missing installed Conductor roles',
      tempDirPrefix: 'conductor-missing-installed-',
      binScript: driver, libBinScript: driver, configPath,
      binArgs: [configPath, 'This task must never start.'],
      tsconfigPath: join(root, 'tsconfig.json'), expectedExitCode: 1,
      env: { DSH_SNAPSHOT: 'replay', DSH_TELEMETRY_DISABLED: '1' },
      prepare: async (cwd) => {
        await mkdir(join(cwd, '.git'))
        const preset = join(cwd, 'installed-presets/conductor')
        await mkdir(preset, { recursive: true })
        for (const file of ['preset.yml', 'agent.cordis.yml']) await copyFile(join(shipped, file), join(preset, file))
      },
    })
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('required skill "conductor-detective" is unavailable or empty')
    expect(result.stderr).toContain('rebuild or reinstall the Conductor preset assets')
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)
})
