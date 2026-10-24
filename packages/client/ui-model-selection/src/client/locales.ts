/**
 * `model` namespace dictionaries.
 *
 * `trigger.selectAria` reads identically to `trigger.fallback` today and is
 * still a separate key: the visible fallback label and the accessible name of
 * an unset trigger are free to diverge per locale, and folding it into
 * `trigger.aria` would announce the degenerate "Select model, current Select
 * model".
 */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'command.description': 'Vælg modellen til denne samtale',
  'option.loadError': 'Kunne ikke indlæse kataloget: {message}',
  'trigger.fallback': 'Vælg model',
  'trigger.selectAria': 'Vælg model',
  'trigger.aria': 'Vælg model, aktuelt {model}',
  'trigger.ariaEffort': 'Vælg model, aktuelt {model}, ræsonnementsniveau {effort}',
  'menu.aria': 'Model og ræsonnementsniveau',
  'menu.model': 'Model',
  'menu.effort': 'Niveau',
  'effort.providerDefault': 'Standard',
  'status.loading': 'Opdaterer modellisten…',
  'error.action': 'Modelhandlingen mislykkedes: {message}',
  'action.reload': 'Genindlæs',
  'warning.groupLoad': 'Kunne ikke indlæse {name}: {message}',
  'empty.models': 'Ingen modeller tilgængelige.',
  'blocked.composer': 'Denne model er utilgængelig — vælg en for at fortsætte',
  'empty.efforts': 'Denne model tilbyder ingen ræsonnementsniveauer.',
} satisfies Record<string, string>

/** The model namespace key union. */
export type ModelKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'command.description': 'Select the model for this conversation',
  'option.loadError': 'Catalog failed to load: {message}',
  'trigger.fallback': 'Select model',
  'trigger.selectAria': 'Select model',
  'trigger.aria': 'Select model, current {model}',
  'trigger.ariaEffort': 'Select model, current {model}, reasoning effort {effort}',
  'menu.aria': 'Model and reasoning effort',
  'menu.model': 'Model',
  'menu.effort': 'Effort',
  'effort.providerDefault': 'Default',
  'status.loading': 'Refreshing model list…',
  'error.action': 'Model operation failed: {message}',
  'action.reload': 'Reload',
  'warning.groupLoad': '{name} failed to load: {message}',
  'empty.models': 'No models available.',
  'blocked.composer': 'This model is unavailable — select one to continue',
  'empty.efforts': 'This model provides no reasoning effort levels.',
} satisfies Record<ModelKey, string>
