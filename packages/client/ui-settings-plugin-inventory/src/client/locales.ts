/** Copy dictionaries for the plugin inventory Settings section. */

/** Danish dictionary and key source of truth. */
export const da = {
  'tab': 'Pluginliste',
  'loading': 'Indlæser plugins…',
  'error': 'Plugins er midlertidigt utilgængelige.',
  'retry': 'Prøv igen',
  'search': 'Søg efter plugins',
  'catalog': 'Pluginliste',
  'empty': 'Ingen plugins tilgængelige.',
  'emptySearch': 'Ingen matchende plugins.',
  'enabledTag': 'Aktiveret',
  'disabledTag': 'Deaktiveret',
  'configuration': 'Konfiguration',
  'cordis': 'Cordis-status',
  'unobserved': 'Ikke indlæst',
  'pending': 'Afventer afhængigheder',
  'loadingPhase': 'Indlæser',
  'active': 'Indlæst',
  'failed': 'Indlæsning mislykkedes',
  'unloading': 'Fjerner fra runtime',
} satisfies Record<string, string>

/** Plugin inventory locale key union. */
export type PluginInventoryLocaleKey = keyof typeof da

/** English dictionary checked against the Chinese key set. */
export const en = {
  tab: 'Plugin list',
  loading: 'Reading plugins…',
  error: 'Plugins are temporarily unavailable.',
  retry: 'Retry',
  search: 'Search plugins',
  catalog: 'Plugin list',
  empty: 'No plugins are available.',
  emptySearch: 'No matching plugins.',
  enabledTag: 'Enabled',
  disabledTag: 'Disabled',
  configuration: 'Configuration',
  cordis: 'Cordis status',
  unobserved: 'Not mounted',
  pending: 'Waiting for dependencies',
  loadingPhase: 'Loading',
  active: 'Mounted',
  failed: 'Mount failed',
  unloading: 'Unloading',
} satisfies Record<PluginInventoryLocaleKey, string>
