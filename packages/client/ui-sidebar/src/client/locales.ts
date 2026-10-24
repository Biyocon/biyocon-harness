/** `sidebar` namespace dictionaries: shell controls (brand row, New Session, fold toggle). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'session.new': 'Ny session',
  'session.new.label': 'Ny session',
  'toggle.open': 'Åbn sidepanel',
  'toggle.collapse': 'Fold sidepanel sammen',
} satisfies Record<string, string>

/** The sidebar namespace key union. */
export type SidebarKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'session.new': 'New Session',
  'session.new.label': 'New session',
  'toggle.open': 'Open sidebar',
  'toggle.collapse': 'Collapse sidebar',
} satisfies Record<SidebarKey, string>
