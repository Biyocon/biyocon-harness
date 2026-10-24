/** `settings.permission` namespace dictionaries (the Permission row's copy). */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'permission.preset.readOnly': 'Skrivebeskyttet',
  'permission.preset.workspaceWrite': 'Skriv i arbejdsområde',
  'permission.preset.fullAccess': 'Fuld adgang',
  'title': 'Tilladelser',
  'description': 'Vælg standardtilladelsen for nye sessioner',
  'loading': 'Indlæser',
  'unavailable': 'Utilgængelig',
  'confirm.title': 'Aktivér fuld adgang?',
  'confirm.description': 'Fuld adgang lader nye sessioner reducere antallet af bekræftelser og udføre flere handlinger direkte, herunder følsomme handlinger, filændringer og eksterne kommandoer. Brug det kun, når du har tillid til de efterfølgende opgaver.',
  'confirm.acknowledge': 'Jeg forstår risikoen og vil fortsætte',
  'confirm.cancel': 'Annuller',
  'confirm.enable': 'Aktivér fuld adgang',
} satisfies Record<string, string>

/** The settings.permission namespace key union. */
export type PermissionSettingsKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'permission.preset.readOnly': 'Read Only',
  'permission.preset.workspaceWrite': 'Workspace Write',
  'permission.preset.fullAccess': 'Full access',
  'title': 'Permission',
  'description': 'Choose the default permission mode for new sessions',
  'loading': 'Loading',
  'unavailable': 'Unavailable',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access lets new sessions reduce confirmation steps and perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust subsequent tasks.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionSettingsKey, string>

/** Danish dictionary for the current-session popup gate. */
export const accessDa = {
  'permission.preset.readOnly': 'Skrivebeskyttet',
  'permission.preset.workspaceWrite': 'Skriv i arbejdsområde',
  'permission.preset.fullAccess': 'Fuld adgang',
  'confirm.title': 'Aktivér fuld adgang?',
  'confirm.description': 'Fuld adgang reducerer antallet af bekræftelser og lader agenten udføre flere handlinger direkte, herunder følsomme handlinger, filændringer og eksterne kommandoer. Brug det kun, når du har tillid til den aktuelle opgave.',
  'confirm.acknowledge': 'Jeg forstår risikoen og vil fortsætte',
  'confirm.cancel': 'Annuller',
  'confirm.enable': 'Aktivér fuld adgang',
} satisfies Record<string, string>

/** Current-session popup-gate key union. */
export type PermissionAccessKey = keyof typeof accessDa

/** English dictionary for the current-session popup gate. */
export const accessEn = {
  'permission.preset.readOnly': 'Read Only',
  'permission.preset.workspaceWrite': 'Workspace Write',
  'permission.preset.fullAccess': 'Full access',
  'confirm.title': 'Enable Full access?',
  'confirm.description': 'Full access reduces confirmation steps and lets the agent perform more actions directly, including sensitive operations, file changes, or external commands. Only use it when you trust the current task.',
  'confirm.acknowledge': 'I understand the risks and want to continue',
  'confirm.cancel': 'Cancel',
  'confirm.enable': 'Enable Full access',
} satisfies Record<PermissionAccessKey, string>
