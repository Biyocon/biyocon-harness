import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { executionBaselineHash } from '@deepseek-ai/dsh-conductor'
import type { ExecutionAuthorization, ExecutionBaseline } from '@deepseek-ai/dsh-conductor'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import {
  IMPLEMENTATION_TOOLS,
  READ_TOOLS,
  toolGuardForStage,
  toolRestrictionForStage,
  WRITE_TOOLS,
} from '../src/capability.ts'

const WRITE_AUTHORIZATION: ExecutionAuthorization = {
  executionBaselineHash: '0'.repeat(64),
  effectProfile: { filesystem: 'workspace-write', quality: 'none', external: 'none' },
}

function authorize(baseline: ExecutionBaseline): ExecutionAuthorization {
  return { ...WRITE_AUTHORIZATION, executionBaselineHash: executionBaselineHash(baseline) }
}

const filesystem = vi.hoisted(() => ({ rejectExistenceChecks: false }))

vi.mock('node:fs', async (importOriginal) => {
  const original = await importOriginal<typeof import('node:fs')>()
  return {
    ...original,
    existsSync: (path: Parameters<typeof original.existsSync>[0]) =>
      filesystem.rejectExistenceChecks ? false : original.existsSync(path),
  }
})

describe('dsh-tool-conductor capability policies', () => {
  it('keeps read-only stages to the read/search tools', () => {
    for (const stage of ['detective', 'strategist', 'devils-advocate', 'auditor', 'arbiter'] as const) {
      expect(toolRestrictionForStage(stage, WRITE_AUTHORIZATION)).toEqual({ allow: [...READ_TOOLS] })
    }
  })

  it('removes shell and release-capable tools from the Headsman', () => {
    expect(toolRestrictionForStage('headsman', WRITE_AUTHORIZATION)).toEqual({ allow: [...IMPLEMENTATION_TOOLS] })
  })

  it('denies Headsman writes outside allowed paths and every excluded path', () => {
    const baseline: ExecutionBaseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['packages/conductor'], excludedPaths: ['packages/conductor/private'], rollbackReference: 'HEAD',
      qualityCommands: [],
    }
    const guard = toolGuardForStage('headsman', baseline, authorize(baseline))
    const execution = (file_path: string) => ({
      name: 'write', arguments: { file_path }, agent: { session: { header: { cwd: process.cwd() } } },
    }) as unknown as ToolExecution
    expect(guard(execution('packages/conductor/conductor/README.md'))).toBeUndefined()
    expect(guard(execution('packages/core/session/README.md'))).toMatch(/outside allowed_paths/)
    expect(guard(execution('packages/conductor/private/secret.md'))).toMatch(/excluded/)
  })

  it('limits Integrator writes to docs and Agent Notes inside the baseline', () => {
    const baseline: ExecutionBaseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['.'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [],
    }
    const guard = toolGuardForStage('integrator', baseline, authorize(baseline))
    const execution = (file_path: string) => ({
      name: 'edit', arguments: { file_path }, agent: { session: { header: { cwd: process.cwd() } } },
    }) as unknown as ToolExecution
    expect(guard(execution('docs/architecture.md'))).toBeUndefined()
    expect(guard(execution('.agents/notes/implemented/feature/2026-09-11-conductor-runtime-layer.md'))).toBeUndefined()
    expect(guard(execution('packages/conductor/conductor/src/state.ts'))).toMatch(/outside docs\/notes/)
  })

  it('denies a write that escapes allowed paths through a symlink or junction', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-conductor-policy-'))
    try {
      const allowed = join(root, 'allowed')
      const outside = join(root, 'outside')
      mkdirSync(allowed)
      mkdirSync(outside)
      symlinkSync(outside, join(allowed, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
      const baseline: ExecutionBaseline = {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: [allowed], excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommands: [],
      }
      const guard = toolGuardForStage('headsman', baseline, authorize(baseline))
      const execution = {
        name: 'write',
        arguments: { file_path: join(allowed, 'alias', 'escape.md') },
        agent: { session: { header: { cwd: root } } },
      } as unknown as ToolExecution
      expect(guard(execution)).toMatch(/outside allowed_paths/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it.each(['headsman', 'integrator'] as const)('protects Git metadata from %s even with an owner-authorized workspace root', (stage) => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-conductor-git-metadata-'))
    try {
      mkdirSync(join(root, '.git', 'hooks'), { recursive: true })
      mkdirSync(join(root, 'nested', '.git'), { recursive: true })
      const baseline: ExecutionBaseline = {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: ['.'], excludedPaths: [], rollbackReference: 'HEAD', qualityCommands: [],
      }
      const guard = toolGuardForStage(stage, baseline, authorize(baseline))
      const execution = (name: 'write' | 'edit' | 'read', file_path: string) => ({
        name, arguments: { file_path }, agent: { session: { header: { cwd: root } } },
      }) as unknown as ToolExecution
      for (const name of ['write', 'edit'] as const) {
        for (const path of ['.git', '.git/config', '.git/hooks/pre-commit', 'nested/.git/config',
          '.GIT/config', 'nested/.GiT/hooks/pre-push', '.git/../docs/architecture.md', join(root, '.git', 'config')]) {
          expect(guard(execution(name, path)), `${name}: ${path}`).toMatch(/Git metadata/)
        }
      }
      expect(guard(execution('write', 'docs/architecture.md'))).toBeUndefined()
      expect(guard(execution('edit', 'docs/.github/config.yml'))).toBeUndefined()
      expect(guard(execution('write', 'docs/.gitkeep'))).toBeUndefined()
      expect(guard(execution('read', '.git/config'))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('protects both supplied Git paths and canonical Git targets behind aliases', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-conductor-git-alias-'))
    try {
      const metadata = join(root, '.git')
      const ordinary = join(root, 'docs')
      mkdirSync(join(metadata, 'hooks'), { recursive: true })
      mkdirSync(ordinary)
      mkdirSync(join(root, 'linked'))
      const directoryLink = process.platform === 'win32' ? 'junction' : 'dir'
      symlinkSync(metadata, join(root, 'metadata-alias'), directoryLink)
      symlinkSync(ordinary, join(root, 'linked', '.git'), directoryLink)
      const baseline: ExecutionBaseline = {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: ['.'], excludedPaths: [], rollbackReference: 'HEAD', qualityCommands: [],
      }
      const guard = toolGuardForStage('headsman', baseline, authorize(baseline))
      const execution = (file_path: string) => ({
        name: 'edit', arguments: { file_path }, agent: { session: { header: { cwd: root } } },
      }) as unknown as ToolExecution
      expect(guard(execution('metadata-alias/config'))).toMatch(/Git metadata/)
      expect(guard(execution('metadata-alias/hooks/pre-commit'))).toMatch(/Git metadata/)
      expect(guard(execution('linked/.git/architecture.md'))).toMatch(/Git metadata/)
      expect(guard(execution('docs/architecture.md'))).toBeUndefined()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('gives the Integrator read and write tools but no shell', () => {
    expect(toolRestrictionForStage('integrator', WRITE_AUTHORIZATION)).toEqual({ allow: [...READ_TOOLS, ...WRITE_TOOLS] })
  })

  it('requires matching host authorization for write-capable stages', () => {
    expect(toolRestrictionForStage('headsman', null)).toEqual({ allow: [...READ_TOOLS] })
    const baseline: ExecutionBaseline = {
      scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
      allowedPaths: ['.'], excludedPaths: [], rollbackReference: 'HEAD',
      qualityCommands: [],
    }
    const guard = toolGuardForStage('headsman', baseline, null)
    expect(guard({ name: 'read', arguments: {} } as ToolExecution)).toBeUndefined()
    expect(guard({ name: 'write', arguments: { file_path: 'sandbox/output.txt' } } as ToolExecution))
      .toMatch(/lacks matching host authorization/)
    const stale = { ...WRITE_AUTHORIZATION, executionBaselineHash: 'f'.repeat(64) }
    expect(toolGuardForStage('headsman', baseline, stale)({
      name: 'write', arguments: { file_path: 'sandbox/output.txt' },
    } as ToolExecution)).toMatch(/lacks matching host authorization/)
  })

  it('requires baselines for write-capable stages and ignores reads for read-only stages', () => {
    expect(() => toolGuardForStage('headsman', null, WRITE_AUTHORIZATION)).toThrow(/approved execution baseline/)
    expect(() => toolGuardForStage('integrator', null, WRITE_AUTHORIZATION)).toThrow(/approved execution baseline/)
    expect(toolGuardForStage('auditor', null, null)({ name: 'read', arguments: {} } as ToolExecution))
      .toBeUndefined()
  })

  it('rejects malformed or unresolvable write targets and accepts absolute in-scope targets', () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-conductor-targets-'))
    try {
      const baseline: ExecutionBaseline = {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: [root], excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommands: [],
      }
      const guard = toolGuardForStage('headsman', baseline, authorize(baseline))
      expect(guard({ name: 'write', arguments: null } as unknown as ToolExecution)).toMatch(/requires file_path/)
      expect(guard({ name: 'write', arguments: { file_path: '' } } as ToolExecution)).toMatch(/requires file_path/)
      expect(guard({ name: 'read', arguments: {} } as ToolExecution)).toBeUndefined()
      expect(guard({ name: 'write', arguments: { file_path: join(root, 'new.md') } } as ToolExecution)).toBeUndefined()

      const missingRoot = join(root, 'missing', 'file.md')
      const missingBaseline: ExecutionBaseline = {
        scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
        allowedPaths: [missingRoot], excludedPaths: [], rollbackReference: 'HEAD',
        qualityCommands: [],
      }
      const missingGuard = toolGuardForStage('headsman', missingBaseline, authorize(missingBaseline))
      filesystem.rejectExistenceChecks = true
      try {
        expect(missingGuard({ name: 'write', arguments: { file_path: missingRoot } } as ToolExecution))
          .toMatch(/could not be canonicalized/)
      } finally {
        filesystem.rejectExistenceChecks = false
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('normalizes path comparisons consistently on case-sensitive and case-insensitive hosts', () => {
    const original = Object.getOwnPropertyDescriptor(process, 'platform')
    if (original?.configurable !== true) return
    const root = mkdtempSync(join(tmpdir(), 'dsh-conductor-case-'))
    try {
      for (const platform of ['win32', 'linux']) {
        Object.defineProperty(process, 'platform', { ...original, value: platform })
        const baseline: ExecutionBaseline = {
          scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'accept-1',
          allowedPaths: [root], excludedPaths: [], rollbackReference: 'HEAD',
          qualityCommands: [],
        }
        const guard = toolGuardForStage('headsman', baseline, authorize(baseline))
        expect(guard({ name: 'write', arguments: { file_path: join(root, 'case.md') } } as ToolExecution))
          .toBeUndefined()
      }
    } finally {
      Object.defineProperty(process, 'platform', original)
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects stages that own no specialist capability policy', () => {
    for (const stage of ['intake', 'ralph', 'closeout'] as const) {
      expect(() => toolRestrictionForStage(stage, null)).toThrow(/capability policy/)
    }
  })
})
