/** Machine value of the preset that requires an explicit GUI risk gate. */
export const FULL_ACCESS_PRESET = 'danger-full-access'

/**
 * Localize known presets; retain the display transform for unknown host names.
 * @param value - preset machine value.
 * @param name - host-supplied preset name.
 * @param t - the surface's locale translator.
 * @returns the localized product label or the conventional host display name.
 */
export function displayPermissionPreset(
  value: string,
  name: string,
  t: (key: 'permission.preset.readOnly' | 'permission.preset.workspaceWrite' | 'permission.preset.fullAccess') => string,
): string {
  switch (value) {
    case 'read-only': return t('permission.preset.readOnly')
    case 'workspace-write': return t('permission.preset.workspaceWrite')
    case FULL_ACCESS_PRESET: return t('permission.preset.fullAccess')
  }
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) return name
  return name.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
}
