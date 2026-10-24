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
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type Schema from '@deepseek-ai/schemastery'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import { scopeOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-skill'

/** Cordis plugin name. */
export const name = 'conductor-presets'
/** The preset owns an isolated skill registry shared with its Conductor tool. */
export const inject = ['skills']

/** Installation directories containing the generated canonical skills. */
export interface Config {
  /** Absolute directory containing the seven role Markdown files. */
  rolesDirectory: string
  /** Absolute root containing the conductor-* protocol skill directories. */
  protocolDirectory: string
}

/** Required installation paths; neither is derived from a task workspace. */
export const Config: Schema<Config> = z.object({
  rolesDirectory: z.string().min(1).required(),
  protocolDirectory: z.string().min(1).required(),
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
 * @throws when a directory is relative or a required skill is absent or empty.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  for (const field of ['rolesDirectory', 'protocolDirectory'] as const) {
    if (!isAbsolute(config[field])) throw new Error(`conductor-presets: ${field} must be an absolute installation path`)
  }
  for (const [providerName, bundledSkillDir] of [
    ['conductor-roles', config.rolesDirectory],
    ['conductor-protocols', config.protocolDirectory],
  ] as const) {
    await ctx.plugin(SkillFileSystem, { providerName, bundledSkillDir, includeDefaultRoots: false, watch: false })
  }
  for (const skillName of [...ROLE_SKILL_NAMES, ...PROTOCOL_SKILL_NAMES]) {
    const skill = await ctx.skills.get(skillName, { scope: scopeOf(ctx) })
    if (skill === undefined || skill.content.length === 0) {
      throw new Error(`conductor-presets: required skill "${skillName}" is unavailable or empty; rebuild or reinstall the Conductor preset assets`)
    }
  }
}
