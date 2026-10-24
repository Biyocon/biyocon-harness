/** `command` namespace dictionaries (the popupSelect shell's copy). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'search.placeholder': 'Søg…',
  'search.aria': 'Filtrer valgmuligheder',
  'status.loading': 'Indlæser valgmuligheder…',
  'status.applying': 'Anvender…',
  'status.empty': 'Ingen valgmuligheder',
  'overlay.aria': 'Valgmuligheder for /{command}',
  'listbox.aria': 'Match for /{command}',
} satisfies Record<string, string>

/** The command namespace key union. */
export type CommandKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'search.placeholder': 'Search…',
  'search.aria': 'Filter options',
  'status.loading': 'Loading options…',
  'status.applying': 'Applying…',
  'status.empty': 'No options',
  'overlay.aria': '/{command} options',
  'listbox.aria': '/{command} matches',
} satisfies Record<CommandKey, string>
