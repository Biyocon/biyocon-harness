/**
 * Conductor run-state runtime entry point.
 *
 * This package owns the Conductor run and gate vocabulary, state machine,
 * host-authorized execution baseline, durable evidence lineage, and persistence.
 * This entry point exposes those contracts to runtime consumers.
 * @module @deepseek-ai/dsh-conductor
 */

export { ConductorRunId, QualityCommandId, QualityEvidenceId } from './types.ts'
export type {
  ArbiterDecision,
  ChangeRequest,
  ChangeRequestTarget,
  ConductorAction,
  ExecutionAuthorization,
  ExecutionEffectProfile,
  ConductorAuthority,
  ConductorBudget,
  ConductorCloseoutAction,
  ConductorRun,
  ConductorRunStatus,
  ConductorStage,
  Confidence,
  CloseoutAuthorization,
  CloseoutRecord,
  DecisionRecord,
  DefectClass,
  EvidenceItem,
  EvidenceKind,
  ExecutionBaseline,
  ExecutionBaselineProposal,
  Finding,
  FindingSeverity,
  GateDecision,
  GateId,
  GateRecord,
  QualityCommandBinding,
  QualityExecutionFailure,
  QualityExecutionRecord,
  QualityExecutorStage,
  QualityPolicyStage,
  RecommendedTransition,
  SpecialistEnvelope,
  SpecialistProblem,
  SpecialistStatus,
  AnalysisEnvelope,
  CapturedReport,
  ConductorAdmission,
  ConductorEntry,
  ConductorMaterialId,
  EvaluatedGateRecord,
  IntakeMaterial,
  IntakeSelection,
  RepairReturn,
  ReportCandidate,
  ReportDecision,
  ReportDeliverable,
  SkippedGateRecord,
} from './types.ts'
export { admitIntake, admittedRoute, captureIntakeMaterial, CONDUCTOR_ENTRIES, contentHash, reportProducer } from './intake.ts'
export { currentAuditHash, reportHash } from './analysis.ts'
export {
  closeRun,
  CONDUCTOR_RECORD_FORMAT_VERSION,
  createRun,
  gateOfStage,
  nextStageAfterPass,
  recordGate,
  reworkCycles,
  stageOfGate,
} from './state.ts'
export type { CreateRunInput, GateVerdict } from './state.ts'
export {
  InMemoryConductorRunStore,
  SessionConductorRunStore,
  parseRun,
  resumeRun,
  serializeRun,
  validateResumable,
} from './persistence.ts'
export type { ConductorCheckpointData, ConductorRunStore } from './persistence.ts'
export { decisionForStatus, reworkTarget, routeGate } from './routing.ts'
export type { RoutedGate } from './routing.ts'
export { drive, SpecialistExecutionFailure } from './drive.ts'
export type { ConductorCheckpoint, ConductorDispatcher, ConductorOutcome, SpecialistDispatchResult } from './drive.ts'
export { executionBaselineHash, executionEffectProfile, nextQualityCycle, snapshotQualityBindings } from './quality.ts'
export { isValidRunId, mintRunId } from './run-id.ts'
