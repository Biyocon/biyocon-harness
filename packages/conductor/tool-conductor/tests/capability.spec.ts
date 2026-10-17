import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
    expect(guard({ name: 'write', arguments: { file_path: 'sandbox/output.txt' } } as ToolExecution))
      .toMatch(/lacks matching host authorization/)
    const stale = { ...WRITE_AUTHORIZATION, executionBaselineHash: 'f'.repeat(64) }
    expect(toolGuardForStage('headsman', baseline, stale)({
      name: 'write', arguments: { file_path: 'sandbox/output.txt' },
    } as ToolExecution)).toMatch(/lacks matching host authorization/)
  })

  it('rejects stages that own no specialist capability policy', () => {
    for (const stage of ['intake', 'ralph', 'closeout'] as const) {
      expect(() => toolRestrictionForStage(stage, null)).toThrow(/capability policy/)
    }
  })
})
