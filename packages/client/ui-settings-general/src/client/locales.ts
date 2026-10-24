/** Shell chrome and General-nav dictionaries; feature rows own their copy. */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'trigger': 'Indstillinger',
  'title': 'Indstillinger',
  'close': 'Luk',
  'openDocument': 'Åbn konfigurationsfil',
  'openDocument.error': 'Kunne ikke åbne konfigurationsfilen',
  'general.nav': 'Generelt',
} satisfies Record<string, string>

/** The settings namespace key union. */
export type SettingsKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'trigger': 'Settings',
  'title': 'Settings',
  'close': 'Close',
  'openDocument': 'Open configuration file',
  'openDocument.error': 'Could not open configuration file',
  'general.nav': 'General',
} satisfies Record<SettingsKey, string>
