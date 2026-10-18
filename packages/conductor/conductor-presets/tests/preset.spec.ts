import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ROLE_DIR, ROLE_SKILL, ROLE_SKILL_NAMES } from '../src/index.ts'

const PRESET_PATH = 'apps/cli/config/agent-presets/conductor/agent.cordis.yml'

const ROLE_PRESENTATION = {
  '01-detective.md': { displayName: 'Detective', avatar: '01-detective.png' },
  '02-strategist.md': { displayName: 'Strategist', avatar: '02-strategist.png' },
  '03-devils-advocate.md': { displayName: "Devil's Advocate", avatar: '03-devils-advocate.png' },
  '04-headsman.md': { displayName: 'Headsman', avatar: '04-headsman.png' },
  '05-auditor.md': { displayName: 'Auditor', avatar: '05-auditor.png' },
  '06-integrator.md': { displayName: 'Integrator', avatar: '06-integrator.png' },
  '07-the-arbiter.md': { displayName: 'The Arbiter', avatar: '07-the-arbiter.png' },
} as const

function expectSquarePng(bytes: Buffer, file: string): void {
  expect(bytes.subarray(0, 8), `${file} PNG signature`).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  expect(bytes.readUInt32BE(16), `${file} width`).toBe(1254)
  expect(bytes.readUInt32BE(20), `${file} height`).toBe(1254)
}

describe('dsh-conductor-presets', () => {
  it('ships exactly one role skill per gated stage with a matching frontmatter name', async () => {
    const files = (await readdir(ROLE_DIR)).filter(name => name.endsWith('.md')).sort()
    const discovered = new Set<string>()
    for (const file of files) {
      const content = await readFile(join(ROLE_DIR, file), 'utf8')
      const name = /^---\nname: ([a-z0-9-]+)\n/.exec(content)?.[1]
      expect(name, `${file} frontmatter name`).toBeTruthy()
      discovered.add(name!)
      expect(content).toMatch(/^description: \S/m)
      expect(content).toMatch(/^disable-model-invocation: true$/m)
      expect(content).toMatch(/^user-invocable: false$/m)
      const presentation = ROLE_PRESENTATION[file as keyof typeof ROLE_PRESENTATION]
      expect(presentation, `${file} presentation`).toBeDefined()
      expect(content).toContain(`  displayName: ${presentation.displayName}\n`)
      expect(content).toContain(`  avatar: ${presentation.avatar}\n`)
      expectSquarePng(await readFile(join(ROLE_DIR, presentation.avatar)), presentation.avatar)
    }
    expect([...discovered].sort()).toEqual([...ROLE_SKILL_NAMES].sort())
  })

  it('ships a complete profile manifest and keeps the alternate Arbiter image inactive', async () => {
    const manifest = await readFile(join(ROLE_DIR, 'profiles.yml'), 'utf8')
    expect(manifest).toContain('  conductor:\n    displayName: The Conductor\n    avatar: 00-conductor.png\n')
    for (const { displayName, avatar } of Object.values(ROLE_PRESENTATION)) {
      expect(manifest).toContain(`    displayName: ${displayName}\n    avatar: ${avatar}\n`)
    }
    expect(manifest).toContain('unassignedAssets:\n  - file: 07-the-arbiter-alternate.png\n')
    expectSquarePng(await readFile(join(ROLE_DIR, '00-conductor.png')), '00-conductor.png')
    const alternate = await readFile(join(ROLE_DIR, '07-the-arbiter-alternate.png'))
    expect(alternate.readUInt32BE(16)).toBe(564)
    expect(alternate.readUInt32BE(20)).toBe(847)
  })

  it('maps every gated stage to a distinct role skill', () => {
    expect(Object.keys(ROLE_SKILL)).toHaveLength(7)
    expect(new Set(Object.values(ROLE_SKILL)).size).toBe(7)
    expect(ROLE_SKILL_NAMES).toEqual([
      'conductor-detective',
      'conductor-strategist',
      'conductor-devils-advocate',
      'conductor-headsman',
      'conductor-auditor',
      'conductor-integrator',
      'conductor-arbiter',
    ])
  })

  it('ships a complete preset with filesystem, roles, workflow, and internal-Ralph Conductor composition', async () => {
    const content = await readFile(PRESET_PATH, 'utf8')
    expect(content).toContain("name: '@deepseek-ai/dsh-tool-conductor'")
    expect(content).toContain("name: '@deepseek-ai/dsh-skill-filesystem'")
    expect(content).toContain("name: '@deepseek-ai/dsh-tool-fs'")
    expect(content).toContain("name: '@deepseek-ai/dsh-tool-fs-search'")
    expect(content).toContain("name: '@deepseek-ai/dsh-workflow-worker-thread'")
    expect(content).not.toContain("name: '@deepseek-ai/dsh-tool-ralph'")
    expect(content).toContain('maxRalphRounds: 3')
    expect(content).toContain('workflowEngine: true')
    expect(content).toContain('includeDefaultRoots: false')
    expect(content).toContain(`- ${ROLE_DIR}`)
  })
})
