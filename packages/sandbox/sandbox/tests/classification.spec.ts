import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyRunnerFailure,
  isRunnerSpawnFailure,
  matchesSandboxSignature,
  type RunnerFailureRule,
} from '../src/index.ts'

describe('sandbox result classification', () => {
  it('matches only nonzero exits against the active denial dialect', () => {
    expect(matchesSandboxSignature(1, 'Permission denied', ['permission denied'])).toBe(true)
    expect(matchesSandboxSignature(0, 'Permission denied', ['permission denied'])).toBe(false)
    expect(matchesSandboxSignature(null, 'Permission denied', ['permission denied'])).toBe(false)
    expect(matchesSandboxSignature(1, 'Operation not permitted', ['read-only file system'])).toBe(false)
  })

  it('requires a fatal runner line after informational exclusions', () => {
    const notice = 'landlock-run: Landlock ABI 1 lacks network isolation'
    const fatal = 'landlock-run: exec failed: No such file or directory'
    const rules: RunnerFailureRule[] = [{
      allowedExitCodes: [125],
      fatalSignatures: ['landlock-run: exec failed:'],
      informationalLines: [notice],
    }]
    expect(classifyRunnerFailure(125, notice, rules)).toBeUndefined()
    expect(classifyRunnerFailure(125, `${notice}\n${fatal}`, rules)).toEqual({ detail: fatal })
    expect(classifyRunnerFailure(1, fatal, rules)).toBeUndefined()
  })

  it('attributes direct spawn errors only to the exact runner with a usable cwd', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-sandbox-classification-'))
    const runner = join(cwd, 'runner')
    writeFileSync(runner, '')
    try {
      expect(isRunnerSpawnFailure({ code: 'ENOENT', path: runner, syscall: 'spawn' }, runner, cwd)).toBe(true)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', path: 'other', syscall: 'spawn' }, runner, cwd)).toBe(false)
      expect(isRunnerSpawnFailure({ code: 'ENOENT', path: runner, syscall: 'spawn' }, runner, join(cwd, 'missing'))).toBe(false)
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })
})
