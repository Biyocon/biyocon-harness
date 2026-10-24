import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { describe, expect, it } from 'vitest'
import * as conductorPresets from '../src/index.ts'

const directories = {
  rolesDirectory: resolve('.agents/conductor/roles'),
  protocolDirectory: resolve('.agents/skills'),
}

describe('installed Conductor skills', () => {
  it('loads canonical role and protocol bodies independently of the task workspace and disposes them', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'conductor-external-workspace-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      const key = {}
      const scope = createScope(ctx, key)
      const mount = await scope.ctx.plugin(conductorPresets, directories)
      const detective = await ctx.skills.get('conductor-detective', { cwd, scope: key })
      const source = await readFile(join(directories.rolesDirectory, '01-detective.md'), 'utf8')
      expect(detective?.content).toBe(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim())
      for (const name of ['conductor-specialist', 'conductor-ralph', 'conductor-closeout']) {
        expect((await ctx.skills.get(name, { cwd, scope: key }))?.content).toBeTruthy()
      }
      await mount.dispose()
      expect(await ctx.skills.list({ cwd, scope: key })).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it.each(['rolesDirectory', 'protocolDirectory'] as const)('rejects missing %s while mounting', async (field) => {
    const empty = await mkdtemp(join(tmpdir(), 'conductor-missing-skills-'))
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await expect(ctx.plugin(conductorPresets, { ...directories, [field]: empty })).rejects.toThrow(
        field === 'rolesDirectory' ? /required skill "conductor-detective"/ : /required skill "conductor-specialist"/,
      )
    } finally {
      await ctx.fiber.dispose()
      await rm(empty, { recursive: true, force: true })
    }
  })

  it('rejects an empty required role before dispatch', async () => {
    const rolesDirectory = await mkdtemp(join(tmpdir(), 'conductor-empty-role-'))
    const ctx = new Context()
    try {
      await writeFile(join(rolesDirectory, '01-detective.md'), '---\nname: conductor-detective\ndescription: Empty role\n---\n')
      await ctx.plugin(SkillRegistry)
      await expect(ctx.plugin(conductorPresets, { ...directories, rolesDirectory }))
        .rejects.toThrow(/required skill "conductor-detective" is unavailable or empty/)
    } finally {
      await ctx.fiber.dispose()
      await rm(rolesDirectory, { recursive: true, force: true })
    }
  })

  it.each(['rolesDirectory', 'protocolDirectory'] as const)('rejects a workspace-relative %s', async (field) => {
    const ctx = new Context()
    try {
      await ctx.plugin(SkillRegistry)
      await expect(ctx.plugin(conductorPresets, { ...directories, [field]: '.agents' }))
        .rejects.toThrow(/absolute installation path/)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
