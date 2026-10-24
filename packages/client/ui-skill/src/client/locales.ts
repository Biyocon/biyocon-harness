/** `skill` namespace dictionaries for the dedicated tool row. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'skill'

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'row.running': 'Indlæser færdighed',
  'row.failed': 'Færdigheden kunne ikke indlæses',
  'row.stopped': 'Indlæsning af færdighed stoppet',
  'row.instructions': 'Instruktioner',
  'menu.userOnly': 'kun bruger',
} satisfies Record<string, string>

/** The skill namespace key union. */
export type SkillKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'row.running': 'Loading skill',
  'row.failed': 'Skill load failed',
  'row.stopped': 'Skill load stopped',
  'row.instructions': 'Instructions',
  'menu.userOnly': 'user-only',
} satisfies Record<SkillKey, string>
