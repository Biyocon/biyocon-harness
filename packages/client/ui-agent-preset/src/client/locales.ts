/** Locale bundles for the agent-preset settings row, hero chip, header label, and management section. */

/** Locale keys these surfaces render. */
export type AgentPresetSettingsKey =
  | 'title' | 'description' | 'loading' | 'error' | 'userTrust' | 'seatHint' | 'headerHint'
  | 'nav' | 'sectionIntro' | 'builtIn' | 'setDefault' | 'view'
  | 'presetStandardName' | 'presetStandardDescription'
  | 'presetCodeName' | 'presetCodeDescription'
  | 'presetMinimalName' | 'presetMinimalDescription'
  | 'presetCordisName' | 'presetCordisDescription'
  | 'presetConductorName' | 'presetConductorDescription'
  | 'duplicate' | 'duplicateUnavailable' | 'delete' | 'presetId' | 'presetIdPlaceholder' | 'copyOf'
  | 'displayName' | 'displayNamePlaceholder'
  | 'inUse' | 'noDescription' | 'builtInGroup' | 'customGroup'
  | 'brokenBadge' | 'brokenNoCopy'
  | 'composition' | 'cancel' | 'close' | 'retry'
  | 'copyTitle' | 'copyIntro' | 'create' | 'creating' | 'creatorDraft'
  | 'openLocation' | 'showLocation' | 'revealedPathLabel'
  | 'idRequired' | 'idInvalid' | 'idTaken'
  | 'deleteTitle' | 'deleteDescription' | 'deleteConfirm' | 'deleting'

/** English copy. */
export const en: Record<AgentPresetSettingsKey, string> = {
  title: 'Agent preset',
  description: 'Applies to sessions you start from now on. Running sessions keep the preset they began with.',
  loading: 'Loading presets…',
  error: 'Could not load agent presets.',
  userTrust: 'Custom',
  seatHint: 'Agent preset for the session you are about to start',
  headerHint: 'The agent preset this session runs, fixed when it started',
  nav: 'Agent presets',
  sectionIntro:
    'A preset is the plugin composition one session\'s agent runs — its tools, prompt, and capabilities. '
    + 'Duplicate an existing one and make it yours, or let the agent draft one for you in Creator mode.',
  builtIn: 'Built-in',
  setDefault: 'Set as default',
  view: 'View',
  presetStandardName: 'Standard mode',
  presetStandardDescription:
    'Full coding agent with file editing, shell, file and web search, skills, planning, goals, subagents, and workflows.',
  presetCodeName: 'PTC mode',
  presetCodeDescription:
    'All Standard mode capabilities, with tools exposed through the Code Mode SDK so the model can combine multi-step operations in one TypeScript program.',
  presetMinimalName: 'Minimal mode',
  presetMinimalDescription:
    'Two-tool coding agent with persistent bash and str_replace_editor.',
  presetCordisName: 'Creator mode',
  presetConductorName: 'Conductor mode',
  presetConductorDescription:
    'Multi-role work with durable gates, bounded fresh specialists, independent audits, and explicit closeout authorization.',
  presetCordisDescription:
    'Built for creating custom agent presets, with all Standard mode capabilities plus runtime inspection, plugin experiments, and preset-authoring guidance.',
  duplicate: 'Duplicate',
  duplicateUnavailable: 'This deployment has no writable preset directory',
  delete: 'Delete',
  presetId: 'Identifier',
  presetIdPlaceholder: 'my-agent',
  displayName: 'Name',
  displayNamePlaceholder: 'Shown in the picker; defaults to the identifier',
  inUse: 'In use',
  builtInGroup: 'Built-in',
  customGroup: 'Custom',
  noDescription: 'No description.',
  brokenBadge: 'Failed to load',
  brokenNoCopy: 'A preset that failed to load cannot be duplicated',
  copyOf: 'Copied from',
  composition: 'Composition (agent.cordis.yml)',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  copyTitle: 'Duplicate preset',
  copyIntro:
    'The whole preset is copied on this machine. The identifier becomes its directory name and cannot '
    + 'be changed later; everything else is edited in the preset\'s own files.',
  create: 'Create',
  creating: 'Creating…',
  creatorDraft: 'Draft a custom preset with Creator mode',
  openLocation: 'Open folder',
  showLocation: 'Show location',
  revealedPathLabel: 'Preset files:',
  idRequired: 'Give the preset an identifier.',
  idInvalid: 'Use lowercase letters, digits, and hyphens, starting with a letter or digit.',
  idTaken: 'A preset with this identifier already exists.',
  deleteTitle: 'Delete this preset?',
  deleteDescription:
    'The preset directory is deleted. Sessions already running on it keep working; new sessions cannot select it.',
  deleteConfirm: 'Delete',
  deleting: 'Deleting…',
}

/** Danish copy. */
export const da: Record<AgentPresetSettingsKey, string> = {
  presetConductorName: 'Conductor-tilstand',
  presetConductorDescription:
    'Arbejde med flere roller, vedvarende kontrolpunkter, afgrænsede nye specialister, uafhængig revision og udtrykkelig tilladelse til afslutning.',
  'title': 'Agent-preset',
  'description': 'Gælder for sessioner, du starter fremover. Igangværende sessioner beholder det preset, de startede med.',
  'loading': 'Indlæser presets…',
  'error': 'Kunne ikke indlæse agent-presets.',
  'userTrust': 'Brugerdefineret',
  'seatHint': 'Agent-preset for den session, du er ved at starte',
  'headerHint': 'Denne sessions agent-preset, som blev fastlagt ved start',
  'nav': 'Agent-presets',
  'sectionIntro': 'Et preset er den plugin-sammensætning, en sessions agent kører med — dens værktøjer, instruks og funktioner. Duplikér et eksisterende preset, og tilpas det, eller lad agenten lave et udkast i Kreatørtilstand.',
  'builtIn': 'Indbygget',
  'setDefault': 'Sæt som standard',
  'view': 'Vis',
  'presetStandardName': 'Standardtilstand',
  'presetStandardDescription': 'Komplet kodeagent med filredigering, shell, fil- og websøgning, færdigheder, planlægning, mål, underagenter og arbejdsforløb.',
  'presetCodeName': 'PTC-tilstand',
  'presetCodeDescription': 'Alle funktioner fra Standardtilstand med værktøjer tilgængelige via Code Mode SDK, så modellen kan kombinere handlinger i flere trin i ét TypeScript-program.',
  'presetMinimalName': 'Minimaltilstand',
  'presetMinimalDescription': 'Kodeagent med to værktøjer: vedvarende bash og str_replace_editor.',
  'presetCordisName': 'Kreatørtilstand',
  'presetCordisDescription': 'Til oprettelse af egne agent-presets med alle funktioner fra Standardtilstand samt inspektion af runtime, plugin-eksperimenter og vejledning i preset-oprettelse.',
  'duplicate': 'Duplikér',
  'duplicateUnavailable': 'Denne installation har ingen skrivbar preset-mappe',
  'delete': 'Slet',
  'presetId': 'Identifikator',
  'presetIdPlaceholder': 'min-agent',
  'displayName': 'Navn',
  'displayNamePlaceholder': 'Vises i vælgeren; identifikatoren bruges som standard',
  'inUse': 'I brug',
  'builtInGroup': 'Indbygget',
  'customGroup': 'Brugerdefineret',
  'noDescription': 'Ingen beskrivelse.',
  'brokenBadge': 'Kunne ikke indlæse',
  'brokenNoCopy': 'Et preset, der ikke kunne indlæses, kan ikke duplikeres',
  'copyOf': 'Kopieret fra',
  'composition': 'Sammensætning (agent.cordis.yml)',
  'cancel': 'Annuller',
  'close': 'Luk',
  'retry': 'Prøv igen',
  'copyTitle': 'Duplikér preset',
  'copyIntro': 'Hele presettet kopieres på denne maskine. Identifikatoren bliver mappens navn og kan ikke ændres senere; alt andet redigeres i presettets egne filer.',
  'create': 'Opret',
  'creating': 'Opretter…',
  'creatorDraft': 'Lav et udkast til et brugerdefineret preset i Kreatørtilstand',
  'openLocation': 'Åbn mappe',
  'showLocation': 'Vis placering',
  'revealedPathLabel': 'Preset-filer:',
  'idRequired': 'Giv presettet en identifikator.',
  'idInvalid': 'Brug små bogstaver, cifre og bindestreger med et bogstav eller ciffer først.',
  'idTaken': 'Der findes allerede et preset med denne identifikator.',
  'deleteTitle': 'Slet dette preset?',
  'deleteDescription': 'Preset-mappen slettes. Sessioner, der allerede bruger det, fortsætter; nye sessioner kan ikke vælge det.',
  'deleteConfirm': 'Slet',
  'deleting': 'Sletter…',
}

/** Preset roster fields needed to resolve Web display copy. */
export interface PresetDisplaySource {
  /** Stable preset id. */
  readonly id: string
  /** Whether the deployment ships the preset or the user owns it. */
  readonly trust: 'system' | 'user'
  /** Unlocalized name published by the preset. */
  readonly name?: string
  /** Unlocalized description published by the preset. */
  readonly description?: string
}

/** Display copy resolved for the active Web locale. */
export interface PresetDisplayText {
  /** Localized built-in name or the preset's own fallback name. */
  readonly name: string
  /** Localized built-in description or the preset's own description. */
  readonly description?: string
}

interface PresetLocaleKeys {
  readonly name: AgentPresetSettingsKey
  readonly description: AgentPresetSettingsKey
}

const BUILT_IN_PRESET_KEYS: Readonly<Partial<Record<string, PresetLocaleKeys>>> = {
  standard: { name: 'presetStandardName', description: 'presetStandardDescription' },
  code: { name: 'presetCodeName', description: 'presetCodeDescription' },
  minimal: { name: 'presetMinimalName', description: 'presetMinimalDescription' },
  cordis: { name: 'presetCordisName', description: 'presetCordisDescription' },
  conductor: { name: 'presetConductorName', description: 'presetConductorDescription' },
}

/**
 * Resolve preset display copy without making user-authored metadata translatable.
 * @param preset - roster row whose copy is being rendered.
 * @param t - active Web locale lookup.
 * @returns localized copy for a known shipped preset, otherwise file metadata.
 */
export function presetDisplayText(
  preset: PresetDisplaySource,
  t: (key: AgentPresetSettingsKey) => string,
): PresetDisplayText {
  const keys = preset.trust === 'system' ? BUILT_IN_PRESET_KEYS[preset.id] : undefined
  if (keys !== undefined) return { name: t(keys.name), description: t(keys.description) }
  return {
    name: preset.name ?? preset.id,
    ...preset.description === undefined ? {} : { description: preset.description },
  }
}
