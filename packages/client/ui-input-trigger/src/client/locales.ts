/**
 * `slash.menu` namespace dictionaries: group titles keyed by source name
 * (the lookup chain returns the key itself, so an unknown source shows its
 * raw name), the pending row, and the listbox aria label.
 */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'command': 'Kommandoer',
  'skill': 'Færdigheder',
  'subagent': 'Underagenter',
  'loading': 'Indlæser…',
  'suggestions.aria': 'Forslag ved indtastning',
} satisfies Record<string, string>

/** The slash.menu namespace key union. */
export type MenuKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'command': 'Commands',
  'skill': 'Skills',
  'subagent': 'Subagents',
  'loading': 'Loading…',
  'suggestions.aria': 'Trigger suggestions',
} satisfies Record<MenuKey, string>
