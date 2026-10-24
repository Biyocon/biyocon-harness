/** `settings.theme` namespace dictionaries (the Appearance row's copy). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'appearance.title': 'Udseende',
  'appearance.light': 'Lyst',
  'appearance.dark': 'Mørkt',
  'appearance.system': 'System',
} satisfies Record<string, string>

/** The settings.theme namespace key union. */
export type ThemeKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'appearance.title': 'Appearance',
  'appearance.light': 'Light',
  'appearance.dark': 'Dark',
  'appearance.system': 'System',
} satisfies Record<ThemeKey, string>
