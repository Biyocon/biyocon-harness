/** `settings.locale` namespace dictionaries (the Language row's copy). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'language.title': 'Sprog',
} satisfies Record<string, string>

/** The settings.locale namespace key union. */
export type SettingsLocaleKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'language.title': 'Language',
} satisfies Record<SettingsLocaleKey, string>
