/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
}

/** Danish copy. */
export const da: Record<PluginsSettingsLocaleKey, string> = {
  'nav': 'Plugins',
  'title': 'Plugins',
  'intro': 'Konfigurer og undersøg de plugins, der er installeret her.',
  'tabs': 'Pluginvisninger',
  'configurableTab': 'Pluginkonfiguration',
  'empty': 'Denne installation tilbyder ingen pluginindstillinger.',
  'overridden': 'Tilsidesat',
  'reset': 'Nulstil til standard',
  'readOnly': 'Denne installation gemmer indstillinger som skrivebeskyttede.',
  'expand': 'Vis indstillinger',
  'collapse': 'Skjul indstillinger',
  'save': 'Gem',
  'saving': 'Gemmer…',
  'discard': 'Kassér',
  'unsaved': 'Ikke gemt',
  'saveFailed': 'Installationen accepterede ikke disse værdier; de er bevaret, så du kan rette dem.',
  'invalidNumber': 'Angiv et tal, eller lad feltet være tomt for at bruge standardværdien.',
  'bashTitle': 'Shell',
  'bashDescription': 'Begrænser hver kommando, agenten kører.',
  'bashTimeoutMs': 'Kommandotimeout (ms)',
  'bashTimeoutMsHint': 'Hvor længe en kommando må køre, før den afsluttes.',
  'bashMaxOutputBytes': 'Outputgrænse pr. strøm (bytes)',
  'bashMaxOutputBytesHint': 'Output over denne grænse gemmes i en midlertidig fil i stedet for at gå tabt.',
  'agentLoopTitle': 'Agentløkke',
  'agentLoopDescription': 'Sådan sender agenten værktøjskald.',
  'agentLoopMaxParallel': 'Parallelle værktøjskald',
  'agentLoopMaxParallelHint': 'Øvre grænse for parallel-sikre kald, der kører samtidigt i ét trin.',
  'webSearchTitle': 'Websøgning',
  'webSearchDescription': 'DeepSeeks søgeudbyder.',
  'webSearchApiKey': 'API-nøgle',
  'webSearchApiKeyHint': 'Gemmes uden for indstillingsfilen. Lad feltet være tomt for at beholde den aktuelle nøgle.',
  'webSearchApiKeySet': 'En nøgle er konfigureret.',
  'webSearchApiKeyUnset': 'Ingen nøgle er konfigureret; søgning er utilgængelig, indtil der er en nøgle.',
  'webSearchBaseUrl': 'Endepunkt',
  'webSearchBaseUrlHint': 'Lad feltet være tomt for at bruge udbyderens standard.',
  'webSearchMaxUses': 'Maksimalt antal søgninger pr. forespørgsel',
  'webSearchMaxUsesHint': 'Hvor mange gange en forespørgsel må søge, før den skal svare.',
}
