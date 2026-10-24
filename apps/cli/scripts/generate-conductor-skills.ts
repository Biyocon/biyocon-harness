import { cp, mkdir, readdir, rm } from 'node:fs/promises'

/**
 * Generate installable skills from the repository's sole authored Conductor sources.
 * @returns after all canonical resources have been copied into the app preset.
 */
export async function generateConductorSkills(): Promise<void> {
  const source = new URL('../../../.agents/', import.meta.url)
  const destination = new URL('../config/agent-presets/conductor/skills/', import.meta.url)
  // Only this generated directory is replaced; authored roles and protocols stay untouched.
  await rm(destination, { recursive: true, force: true })
  await cp(new URL('conductor/roles/', source), new URL('roles/', destination), { recursive: true })
  await mkdir(new URL('protocols/', destination), { recursive: true })
  for (const skill of await readdir(new URL('skills/', source))) {
    if (!skill.startsWith('conductor-')) continue
    await cp(new URL(`skills/${skill}/`, source), new URL(`protocols/${skill}/`, destination), { recursive: true })
  }
}
