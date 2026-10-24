import { readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { Context, type Fiber } from '@deepseek-ai/cordis'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import * as SkillFileSystem from '../src/index.ts'

const ROLE_DIRECTORY = resolve('.agents/conductor/roles')
const IMAGE_LIMIT = 96 * 1024

interface RoleProfile {
  id: string
  displayName: string
  avatar: string
  skill?: string
}

const PROFILES: readonly RoleProfile[] = [
  { id: 'conductor', displayName: 'The Conductor', avatar: '00-conductor.webp' },
  { id: 'detective', displayName: 'Detective', avatar: '01-detective.webp', skill: 'conductor-detective' },
  { id: 'strategist', displayName: 'Strategist', avatar: '02-strategist.webp', skill: 'conductor-strategist' },
  { id: 'devils-advocate', displayName: "Devil's Advocate", avatar: '03-devils-advocate.webp', skill: 'conductor-devils-advocate' },
  { id: 'headsman', displayName: 'Headsman', avatar: '04-headsman.webp', skill: 'conductor-headsman' },
  { id: 'auditor', displayName: 'Auditor', avatar: '05-auditor.webp', skill: 'conductor-auditor' },
  { id: 'integrator', displayName: 'Integrator', avatar: '06-integrator.webp', skill: 'conductor-integrator' },
  { id: 'arbiter', displayName: 'The Arbiter', avatar: '07-the-arbiter.webp', skill: 'conductor-arbiter' },
]

function expectProfileImage(bytes: Buffer): void {
  expect(bytes.length).toBeGreaterThanOrEqual(30)
  expect(bytes.length).toBeLessThanOrEqual(IMAGE_LIMIT)
  expect(bytes.toString('ascii', 0, 4)).toBe('RIFF')
  expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8)
  expect(bytes.toString('ascii', 8, 16)).toBe('WEBPVP8 ')
  expect(bytes.subarray(23, 26)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]))
  expect(bytes.readUInt16LE(26) & 0x3fff).toBe(512)
  expect(bytes.readUInt16LE(28) & 0x3fff).toBe(512)
}

describe('Conductor static profile assets', () => {
  it('maps exactly the parent and seven specialists to their active assets', async () => {
    const manifest: unknown = parse(await readFile(join(ROLE_DIRECTORY, 'profiles.yml'), 'utf8'))
    expect(manifest).toEqual({
      version: 1,
      profiles: Object.fromEntries(PROFILES.map(({ id, displayName, avatar, skill }) => [id, {
        ...skill !== undefined ? { skill } : {}, displayName, avatar,
      }])),
    })
    expect((await readdir(ROLE_DIRECTORY)).filter(file => file.endsWith('.webp')).sort())
      .toEqual(PROFILES.map(profile => profile.avatar).sort())
  })

  it.each(PROFILES)('ships a bounded square WebP for $id', async ({ avatar }) => {
    expectProfileImage(await readFile(join(ROLE_DIRECTORY, avatar)))
  })

  it.each(['container', 'dimensions', 'size'] as const)('rejects an invalid asset %s', async (defect) => {
    const original = await readFile(join(ROLE_DIRECTORY, '00-conductor.webp'))
    const invalid = defect === 'size' ? Buffer.alloc(IMAGE_LIMIT + 1) : Buffer.from(original)
    if (defect === 'container') invalid.write('NOPE', 0)
    if (defect === 'dimensions') invalid.writeUInt16LE(256, 28)
    expect(() => {
      expectProfileImage(invalid)
    }).toThrow()
  })
})

describe('Conductor role metadata through the filesystem provider', () => {
  const ctx = new Context()
  const fibers: Fiber[] = []

  beforeAll(async () => {
    fibers.push(await ctx.plugin(SkillRegistry))
    fibers.push(await ctx.plugin(SkillFileSystem, {
      customSkillDirs: [ROLE_DIRECTORY],
      includeDefaultRoots: false,
      watch: false,
    }))
  })

  afterAll(async () => {
    for (const fiber of fibers.reverse()) await fiber.dispose()
  })

  it.each(PROFILES.filter(profile => profile.skill !== undefined))(
    'preserves $id metadata without inserting it into role instructions',
    async ({ skill: name, avatar, displayName }) => {
      const skill = await ctx.skills.get(name!)
      expect(skill).toBeDefined()
      expect(skill!.metadata).toEqual({ displayName, avatar })
      expect(skill!.resourceBase).toEqual({ kind: 'directory', path: ROLE_DIRECTORY })
      expect(skill!.invocation).toEqual({ modelInvocable: false, userInvocable: false })
      const source = await readFile(join(ROLE_DIRECTORY, avatar.replace('.webp', '.md')), 'utf8')
      expect(skill!.content).toBe(source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim())
      expect(skill!.content).not.toContain('metadata:')
      expect(skill!.content).not.toContain(avatar)
    },
  )
})
