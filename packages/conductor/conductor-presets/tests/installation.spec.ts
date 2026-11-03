import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  sharedProtocolFile: resolve('.agents/conductor/README.md'),
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
      expect(detective?.content).toBe([
        'The shared role protocol is included below as reference. Do not read its repository links from the task workspace; use your dispatch and structured-output schema.',
        (await readFile(directories.sharedProtocolFile, 'utf8')).trim(),
        source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
      ].join('\n\n'))
      for (const name of ['conductor-specialist', 'conductor-ralph', 'conductor-closeout']) {
        expect((await ctx.skills.get(name, { cwd, scope: key }))?.content).toBeTruthy()
      }
      const critic = await ctx.skills.get('conductor-devils-advocate', { cwd, scope: key })
      const specialist = await ctx.skills.get('conductor-specialist', { cwd, scope: key })
      expect(critic?.metadata?.analysisCritic).toMatchObject({ dispatchMode: 'critic' })
      expect(specialist?.metadata?.analysisCritic).toMatchObject({ dispatchMode: 'critic' })
      expect(critic?.content).not.toContain('Return exactly one AnalysisChallenge')
      expect(specialist?.content).not.toContain('Only for a typed critic dispatch')
      await mount.dispose()
      expect(await ctx.skills.list({ cwd, scope: key })).toEqual([])
    } finally {
      await ctx.fiber.dispose()
      await rm(cwd, { recursive: true, force: true })
    }
  })

  it.each([
    { file: '03-devils-advocate.md', kind: 'role', invalid: 'missing' },
    { file: '03-devils-advocate.md', kind: 'role', invalid: 'wrong mode' },
    { file: '03-devils-advocate.md', kind: 'role', invalid: 'array' },
    { file: '03-devils-advocate.md', kind: 'role', invalid: 'empty instructions' },
    { file: 'conductor-specialist/SKILL.md', kind: 'skill', invalid: 'missing' },
    { file: 'conductor-specialist/SKILL.md', kind: 'skill', invalid: 'wrong mode' },
    { file: 'conductor-specialist/SKILL.md', kind: 'skill', invalid: 'array' },
    { file: 'conductor-specialist/SKILL.md', kind: 'skill', invalid: 'empty instructions' },
  ] as const)('rejects a $kind with $invalid critic metadata before dispatch', async ({ file, kind, invalid }) => {
    const installation = await mkdtemp(join(tmpdir(), 'conductor-critic-metadata-'))
    const rolesDirectory = join(installation, 'roles')
    const protocolDirectory = join(installation, 'protocols')
    const ctx = new Context()
    try {
      await cp(directories.rolesDirectory, rolesDirectory, { recursive: true })
      for (const name of ['conductor-specialist', 'conductor-ralph', 'conductor-closeout']) {
        await cp(join(directories.protocolDirectory, name), join(protocolDirectory, name), { recursive: true })
      }
      const target = kind === 'role' ? join(rolesDirectory, file) : join(protocolDirectory, file)
      const source = await readFile(target, 'utf8')
      const corrupted = invalid === 'wrong mode'
        ? source.replace('dispatchMode: critic', 'dispatchMode: producer')
        : invalid === 'empty instructions'
          ? source.replace(/    instructions: >-\r?\n    .+/, '    instructions: ""')
          : source.replace(/  analysisCritic:\r?\n(?:    .*\r?\n)+/, invalid === 'array' ? '  analysisCritic: []\n' : '')
      await writeFile(target, corrupted)
      await ctx.plugin(SkillRegistry)
      await expect(ctx.plugin(conductorPresets, { ...directories, rolesDirectory, protocolDirectory }))
        .rejects.toThrow(/lacks valid analysis critic instructions in metadata/)
    } finally {
      await ctx.fiber.dispose()
      await rm(installation, { recursive: true, force: true })
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

  it.each(['missing', 'empty'] as const)('rejects a %s shared role protocol while mounting', async (variant) => {
    const directory = await mkdtemp(join(tmpdir(), 'conductor-shared-protocol-'))
    const sharedProtocolFile = join(directory, 'README.md')
    const ctx = new Context()
    try {
      if (variant === 'empty') await writeFile(sharedProtocolFile, ' \n')
      await ctx.plugin(SkillRegistry)
      await expect(ctx.plugin(conductorPresets, { ...directories, sharedProtocolFile }))
        .rejects.toThrow(/shared role protocol.*(could not be read|empty).*rebuild or reinstall/)
    } finally {
      await ctx.fiber.dispose()
      await rm(directory, { recursive: true, force: true })
    }
  })

  it.each(['rolesDirectory', 'protocolDirectory', 'sharedProtocolFile'] as const)('rejects a workspace-relative %s', async (field) => {
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
