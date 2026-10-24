/** `plan` namespace dictionaries (the composer plan chip's copy). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'chip.on.aria': 'Plantilstand er slået til, tryk for at slå fra',
  'chip.on.title': 'Plantilstand er slået til — klik for at slå fra (/plan off)',
  'chip.off.aria': 'Plantilstand er slået fra, tryk for at slå til',
  'chip.off.title': 'Plantilstand er slået fra — klik for at slå til (/plan)',
} satisfies Record<string, string>

/** The plan namespace key union. */
export type PlanKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'chip.on.aria': 'Plan mode on, press to turn off',
  'chip.on.title': 'Plan mode on — click to turn off (/plan off)',
  'chip.off.aria': 'Plan mode off, press to turn on',
  'chip.off.title': 'Plan mode off — click to turn on (/plan)',
} satisfies Record<PlanKey, string>
