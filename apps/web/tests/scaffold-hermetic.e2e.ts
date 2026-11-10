import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import type {} from '@deepseek-ai/dsh-skill'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-presets'
import { launchWebScaffold, type WebScaffold } from './scaffold.ts'

it('confines preset instructions to the synthetic workspace while retaining project instructions', async () => {
  const ambient = await mkdtemp(join(tmpdir(), 'dsh-web-ambient-instructions-'))
  await mkdir(join(ambient, '.git'))
  await writeFile(join(ambient, 'AGENTS.md'), 'SYNTHETIC_ANCESTOR_MUST_NOT_ENTER_MODEL')
  const originalTemp = { TEMP: process.env.TEMP, TMP: process.env.TMP, TMPDIR: process.env.TMPDIR }
  Object.assign(process.env, { TEMP: ambient, TMP: ambient, TMPDIR: ambient })
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold({
      replayFixture: fileURLToPath(new URL('./snapshots/minimal-preset/session.jsonl', import.meta.url)),
    })
    await writeFile(join(scaffold.workspaceCwd, 'AGENTS.md'), 'SYNTHETIC_PROJECT_INSTRUCTIONS_REMAIN_ACTIVE')
    const ctx = scaffold.ctx
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-instructions'),
      meta: { cwd: scaffold.workspaceCwd, agentPreset: 'standard' },
      agentOptions: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
      setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'standard').then(() => undefined),
    })
    try {
      handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Reply exactly MINIMAL_PRESET_REQUEST_OK and stop.' }], source: { kind: 'user' } }))
      await handle.agent.whenIdle()
      const events = JSON.stringify(handle.agent.session.events)
      expect(events).not.toContain('SYNTHETIC_ANCESTOR_MUST_NOT_ENTER_MODEL')
      expect(events).toContain('SYNTHETIC_PROJECT_INSTRUCTIONS_REMAIN_ACTIVE')
      expect(handle.agent.session.events.some(event => event.type === 'request/header')).toBe(true)
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      for (const [key, value] of Object.entries(originalTemp)) {
        if (value === undefined) Reflect.deleteProperty(process.env, key)
        else process.env[key] = value
      }
      await rm(ambient, { recursive: true, force: true })
    }
  }
})

async function writeSkill(root: string, name: string): Promise<void> {
  const bundle = join(root, name)
  await mkdir(bundle, { recursive: true })
  await writeFile(join(bundle, 'SKILL.md'), `---
name: ${name}
description: Must not enter the Web replay scaffold
---

Ambient host state.
`)
}

it('isolates replay skill discovery from every ambient host root', async () => {
  const ambient = await mkdtemp(join(tmpdir(), 'dsh-web-ambient-skills-'))
  const dshHome = join(ambient, 'dsh-home')
  const agentsHome = join(ambient, 'agents-home')
  const bundled = join(ambient, 'bundled')
  await Promise.all([
    writeSkill(join(dshHome, 'skills'), 'ambient-dsh'),
    writeSkill(join(agentsHome, 'skills'), 'ambient-agents'),
    writeSkill(bundled, 'ambient-bundled'),
  ])

  const originalDshHome = process.env.DSH_HOME
  const originalAgentsHome = process.env.DSH_AGENTS_HOME
  const originalBundled = process.env.DSH_BUNDLED_SKILL_DIR
  process.env.DSH_HOME = dshHome
  process.env.DSH_AGENTS_HOME = agentsHome
  process.env.DSH_BUNDLED_SKILL_DIR = bundled
  let scaffold: WebScaffold | undefined
  try {
    scaffold = await launchWebScaffold()
    const ctx = scaffold.ctx
    // Local skill discovery belongs to the agent's preset LAYER of the host
    // registry, so the roots under test are only reachable through a composed
    // agent's view — the same scope the gateway's `skill.list` resolves for a
    // browser request about a session.
    const handle = await ctx.agents.create({
      sessionId: SessionId('hermetic-skills'),
      setup: agentCtx => ctx.agentPresets.mount(agentCtx).then(() => undefined),
    })
    try {
      const skills = ctx.get('skills')
      if (skills === undefined) throw new Error('the composition mounts no skill registry')
      const names = (await skills.list({ cwd: scaffold.workspaceCwd, scope: handle.agent })).map(skill => skill.name)
      expect(names).not.toContain('ambient-dsh')
      expect(names).not.toContain('ambient-agents')
      expect(names).not.toContain('ambient-bundled')
    } finally {
      await handle.dispose()
    }
  } finally {
    try {
      await scaffold?.close()
    } finally {
      if (originalDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = originalDshHome
      if (originalAgentsHome === undefined) delete process.env.DSH_AGENTS_HOME
      else process.env.DSH_AGENTS_HOME = originalAgentsHome
      if (originalBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR
      else process.env.DSH_BUNDLED_SKILL_DIR = originalBundled
      await rm(ambient, { recursive: true, force: true })
    }
  }
})
