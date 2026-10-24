/**
 * Installed Conductor role and protocol skills.
 *
 * The shipped preset composition
 * (`apps/cli/config/agent-presets/conductor/agent.cordis.yml`) loads the
 * generated copies of the canonical Markdown through a private skill registry.
 * Installation files are read on the host, independently of the task filesystem.
 * Missing required skills reject the preset mount before an agent is published.
 *
 * @module @deepseek-ai/dsh-conductor-presets
 */

import { isAbsolute } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'

/** Cordis plugin name. */
export const name = 'conductor-presets'
/** The preset owns an isolated skill registry shared with its Conductor tool. */
export const inject = ['skills']

/** Installation locations containing the generated canonical instructions. */
export interface Config {
  /** Absolute directory containing the seven role Markdown files. */
  rolesDirectory: string
  /** Absolute root containing the conductor-* protocol skill directories. */
  protocolDirectory: string
  /** Absolute installation file containing the shared role protocol. */
  sharedProtocolFile: string
}

/** Required installation paths; none is derived from a task workspace. */
export const Config: Schema<Config> = z.object({
  rolesDirectory: z.string().min(1).required(),
  protocolDirectory: z.string().min(1).required(),
  sharedProtocolFile: z.string().min(1).required(),
})

/** Directory holding the specialist role files, relative to the repository root. */
export const ROLE_DIR = '.agents/conductor/roles'

/**
 * Specialist stage name → role skill name, in gate order (Detective through
 * The Arbiter). Keys are the seven gated `ConductorStage` values.
 */
export const ROLE_SKILL: Readonly<Record<string, string>> = {
  detective: 'conductor-detective',
  strategist: 'conductor-strategist',
  'devils-advocate': 'conductor-devils-advocate',
  headsman: 'conductor-headsman',
  auditor: 'conductor-auditor',
  integrator: 'conductor-integrator',
  arbiter: 'conductor-arbiter',
}

/** Every role skill name, in gate order. */
export const ROLE_SKILL_NAMES: readonly string[] = Object.values(ROLE_SKILL)

/** Protocol skills consumed by specialist, Ralph, and Arbiter dispatches. */
const PROTOCOL_SKILL_NAMES: readonly string[] = [
  'conductor-specialist', 'conductor-ralph', 'conductor-closeout',
]

/**
 * Mount and validate the installation's role and protocol providers.
 * @param ctx - preset context carrying its isolated skill registry.
 * @param config - absolute installation directories, not task workspace paths.
 * @throws when a path is relative, a required skill is absent or empty, or the shared protocol is unreadable or empty.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const field of ['rolesDirectory', 'protocolDirectory', 'sharedProtocolFile'] as const) {
    if (!isAbsolute(config[field])) throw new Error(`conductor-presets: ${field} must be an absolute installation path`)
  }
  const roleProvider = await ctx.plugin(SkillFileSystem, {
    providerName: 'conductor-roles', bundledSkillDir: config.rolesDirectory, includeDefaultRoots: false, watch: false,
  })
  await ctx.plugin(SkillFileSystem, {
    providerName: 'conductor-protocols', bundledSkillDir: config.protocolDirectory, includeDefaultRoots: false, watch: false,
  })
  const skills: SkillDefinition[] = []
  for (const skillName of [...ROLE_SKILL_NAMES, ...PROTOCOL_SKILL_NAMES]) {
    const skill = await ctx.skills.get(skillName, { scope: scopeOf(ctx) })
    if (skill === undefined || skill.content.length === 0) {
      throw new Error(`conductor-presets: required skill "${skillName}" is unavailable or empty; rebuild or reinstall the Conductor preset assets`)
    }
    skills.push(skill)
  }
  let sharedProtocol: string
  try {
    sharedProtocol = await readFile(config.sharedProtocolFile, 'utf8')
  } catch (cause: unknown) {
    throw new Error(`conductor-presets: shared role protocol "${config.sharedProtocolFile}" could not be read; rebuild or reinstall the Conductor preset assets`, { cause })
  }
  if (sharedProtocol.trim().length === 0) throw new Error('conductor-presets: shared role protocol is empty; rebuild or reinstall the Conductor preset assets')
  for (const role of skills.slice(0, ROLE_SKILL_NAMES.length)) {
    ctx.skills.register({
      ...role,
      content: [
        'The shared role protocol is included below as reference. Do not read its repository links from the task workspace; use your dispatch and structured-output schema.',
        sharedProtocol.trim(),
        role.content,
      ].join('\n\n'),
    })
  }
  // Prepared role definitions own the composed bodies; keep no duplicate filesystem candidates.
  await roleProvider.dispose()
}
