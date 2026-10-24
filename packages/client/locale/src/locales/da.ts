import type { CommonKey } from './en.ts'

/** Danish dictionary for the common namespace, checked against the English keys. */
export const da = {
  'ok': 'OK',
  'cancel': 'Annuller',
  'close': 'Luk',
  'copy': 'Kopiér',
  'copied': 'Kopieret',
  'retry': 'Prøv igen',
  'loading': 'Indlæser…',
  'load.failed': 'Kunne ikke indlæse',
  'submit': 'Indsend',
  'submitting': 'Indsender…',
  'next': 'Næste',
  'previous': 'Forrige',
  'skip': 'Spring over',
  'delete': 'Slet',
  'edit': 'Rediger',
  'save': 'Gem',
  'search': 'Søg',
  'more': 'Mere',
  'collapse': 'Fold sammen',
  'expand': 'Fold ud',
  'back': 'Tilbage',
  'unknown': 'Ukendt',
  'none': 'Ingen',
  'truncated': 'Afkortet',
} satisfies Record<CommonKey, string>
