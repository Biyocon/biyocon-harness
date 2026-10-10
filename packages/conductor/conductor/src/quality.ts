/** Durable Conductor quality-evidence helpers. */

import { createHash } from 'node:crypto'
import type { ConductorRun, ExecutionBaseline, GateId, QualityCommandBinding } from './types.ts'

/**
 * Hash one immutable execution baseline with fixed field ordering.
 * @param baseline - Gate-C baseline to identify.
 * @returns lowercase SHA-256 hex digest.
 */
export function executionBaselineHash(baseline: ExecutionBaseline): string {
  return createHash('sha256').update(JSON.stringify({
    scopeVersion: baseline.scopeVersion,
    planVersion: baseline.planVersion,
    acceptanceVersion: baseline.acceptanceVersion,
    allowedPaths: baseline.allowedPaths,
    excludedPaths: baseline.excludedPaths,
    rollbackReference: baseline.rollbackReference,
    qualityCommands: baseline.qualityCommands.map(binding => ({
      id: binding.id,
      definitionHash: binding.definitionHash,
      requiredGates: binding.requiredGates,
    })),
  })).digest('hex')
}

/**
 * Number the next attempt at one gate from durable gate history.
 * @param run - current run snapshot.
 * @param gate - Gate D or E.
 * @returns one-based attempt number.
 */
export function nextQualityCycle(run: ConductorRun, gate: Extract<GateId, 'D' | 'E'>): number {
  return 1 + run.history.filter(record => record.gate === gate).length
}

/**
 * Copy command bindings without retaining caller-owned arrays.
 * @param bindings - Gate-C command bindings to detach.
 * @returns detached command bindings in source order.
 */
export function snapshotQualityBindings(bindings: readonly QualityCommandBinding[]): QualityCommandBinding[] {
  return bindings.map(binding => ({
    id: binding.id,
    definitionHash: binding.definitionHash,
    requiredGates: [...binding.requiredGates],
  }))
}
