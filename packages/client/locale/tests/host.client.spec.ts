import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SettingsProvider, settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  LOCALE_SETTINGS_NAMESPACE, apply,
} from '@deepseek-ai/dsh-client-locale'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve({}) }
  protected persist(_ns: SettingsNamespace, _section: Record<string, unknown>): Promise<void> {
    return Promise.resolve()
  }
}

describe('locale host', () => {
  it('registers an optional explicit locale preference with the Host settings lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(MemorySettings).await()
    const fiber = ctx.plugin({ apply })
    await fiber.await()
    const ns = settingsNamespace(LOCALE_SETTINGS_NAMESPACE)
    expect(ctx.settings.get(ns)).toEqual({})
    await ctx.settings.update(ns, { preference: 'en' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'en' })
    await ctx.settings.update(ns, { preference: 'da' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'da' })
    await ctx.settings.update(ns, { preference: 'zh' })
    expect(ctx.settings.get(ns)).toEqual({ preference: 'zh' })
    await expect(ctx.settings.update(ns, { preference: 'fr' })).rejects.toThrow()
    await fiber.dispose()
    expect(ctx.settings.describe().map(row => row.ns)).not.toContain(ns)
  })

  it('loads a stored Chinese preference without rejecting the locale plugin', async () => {
    class StoredChineseSettings extends MemorySettings {
      protected override load(): Promise<Record<string, unknown>> {
        return Promise.resolve({ locale: { preference: 'zh' } })
      }
    }
    const ctx = new Context()
    await ctx.plugin(StoredChineseSettings).await()
    await expect(ctx.plugin({ apply }).await()).resolves.toBeDefined()
    expect(ctx.settings.get(settingsNamespace(LOCALE_SETTINGS_NAMESPACE))).toEqual({ preference: 'zh' })
    await ctx.fiber.dispose()
  })
})
