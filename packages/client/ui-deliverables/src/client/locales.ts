/** `deliverables` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'deliverables'

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'produced.label': 'Oprettet',
  'produced.moreOne': '+ 1 fil',
  'produced.more': '+ {count} filer',
  'produced.open': 'Åbn {name}',
  'produced.showInFolder': 'Vis i mappe',
}

/** English dictionary (same key set). */
export const en: Record<DeliverablesKey, string> = {
  'produced.label': 'Produced',
  'produced.moreOne': '+ 1 file',
  'produced.more': '+ {count} files',
  'produced.open': 'Open {name}',
  'produced.showInFolder': 'Show in folder',
}

/** Union of this namespace's dictionary keys. */
export type DeliverablesKey = keyof typeof da
