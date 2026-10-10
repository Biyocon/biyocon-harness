import { describe, expect, it } from 'vitest'
import { MAX_TIMER_DELAY_MS } from '@deepseek-ai/dsh-timeout'
import { resolveQualityCatalog } from '../src/quality-catalog.ts'
import type { QualityCommandConfig } from '../src/quality-catalog.ts'

function command(overrides: Partial<QualityCommandConfig> = {}): QualityCommandConfig {
  return {
    id: 'unit-check',
    modelSafeDescription: 'Run the unit check.',
    argv: ['node', '--version'],
    cwd: '.',
    allowedStages: ['headsman'],
    sandboxMode: 'read-only',
    timeoutMs: 1000,
    maxOutputBytes: 4096,
    graceMs: 100,
    ...overrides,
  }
}

describe('Conductor quality catalog', () => {
  it('freezes a deterministic definition hash over the normalized command', () => {
    const first = resolveQualityCatalog([command()])
    const second = resolveQualityCatalog([command()])
    expect(first.get('unit-check')?.definitionHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first.get('unit-check')?.definitionHash).toBe(second.get('unit-check')?.definitionHash)
    expect(Object.isFrozen(first.get('unit-check'))).toBe(true)
    expect(Object.isFrozen(first.get('unit-check')?.argv)).toBe(true)
    expect(Object.isFrozen(first.get('unit-check')?.allowedStages)).toBe(true)
  })

  it('rejects raw shell interpreters, duplicate ids, and workspace escapes', () => {
    expect(() => resolveQualityCatalog([command({ argv: ['pwsh', '-Command', 'echo unsafe'] })])).toThrow(/shell interpreter/)
    expect(() => resolveQualityCatalog([command(), command()])).toThrow(/duplicate id/)
    expect(() => resolveQualityCatalog([command({ cwd: '../outside' })])).toThrow(/inside the workspace/)
  })

  it('keeps Auditor commands read-only and requires a writeRoot for workspace writes', () => {
    expect(() => resolveQualityCatalog([command({
      allowedStages: ['auditor'], sandboxMode: 'workspace-write', writeRoot: 'packages/conductor',
    })])).toThrow(/Auditor command must be read-only/)
    expect(() => resolveQualityCatalog([command({ sandboxMode: 'workspace-write' })])).toThrow(/requires writeRoot/)
  })

  it('rejects unknown allowed stages at the direct configuration boundary', () => {
    expect(() => resolveQualityCatalog([command({
      allowedStages: ['integrator' as 'headsman'],
    })])).toThrow(/distinct headsman\/auditor stages/)
  })

  it('rejects timer delays that Node would clamp to one millisecond', () => {
    expect(() => resolveQualityCatalog([command({ timeoutMs: MAX_TIMER_DELAY_MS + 1 })]))
      .toThrow(`timeoutMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
    expect(() => resolveQualityCatalog([command({ graceMs: MAX_TIMER_DELAY_MS + 1 })]))
      .toThrow(`graceMs must be no greater than ${MAX_TIMER_DELAY_MS}`)
  })
})
