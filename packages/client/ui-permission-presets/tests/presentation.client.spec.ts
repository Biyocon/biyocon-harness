import { describe, expect, it, vi } from 'vitest'
import { displayPermissionPreset } from '../src/client/presentation.ts'
import { da, en } from '../src/client/locales.ts'

describe('permission labels', () => {
  it.each([
    ['read-only', 'permission.preset.readOnly'],
    ['workspace-write', 'permission.preset.workspaceWrite'],
    ['danger-full-access', 'permission.preset.fullAccess'],
  ] as const)('translates %s by ID instead of its host label', (id, key) => {
    for (const dictionary of [en, da]) {
      const t = vi.fn((name: keyof typeof dictionary) => dictionary[name])
      expect(displayPermissionPreset(id, 'host label', t)).toBe(dictionary[key])
      expect(t).toHaveBeenCalledExactlyOnceWith(key)
    }
  })

  it('only title-cases unknown kebab names and preserves other host labels', () => {
    const t = vi.fn(() => 'not used')
    expect(displayPermissionPreset('host-special', 'ask-every-time', t)).toBe('Ask Every Time')
    expect(displayPermissionPreset('host-special', 'Host supplied label', t)).toBe('Host supplied label')
    expect(t).not.toHaveBeenCalled()
  })
})
