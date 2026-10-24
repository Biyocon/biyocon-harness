/** `goal` namespace dictionaries. */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'phase.active': 'Aktivt mål',
  'phase.paused': 'Mål på pause',
  'phase.blocked': 'Blokeret mål',
  'objective.aria': 'Målsætning',
  'commandInput.aria': 'Kommandoinput',
  'action.save': 'Gem mål',
  'action.cancel': 'Annuller redigering',
  'action.pause': 'Sæt mål på pause',
  'action.resume': 'Genoptag mål',
  'action.edit': 'Rediger mål',
  'action.clear': 'Ryd mål',
} satisfies Record<string, string>

/** The goal namespace key union. */
export type GoalKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'phase.active': 'Ongoing Goal',
  'phase.paused': 'Paused Goal',
  'phase.blocked': 'Blocked Goal',
  'objective.aria': 'Goal objective',
  'commandInput.aria': 'Command input',
  'action.save': 'Save goal',
  'action.cancel': 'Cancel edit',
  'action.pause': 'Pause goal',
  'action.resume': 'Resume goal',
  'action.edit': 'Edit goal',
  'action.clear': 'Clear goal',
} satisfies Record<GoalKey, string>
