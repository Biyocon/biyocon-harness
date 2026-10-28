/** Model-hidden presentation of one concrete Conductor workflow child. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ConductorRunId, ConductorStage, GateId, GateDecision } from './types.ts'

/** Fixed specialist identities, including the internal Ralph worker. */
export type ConductorChildRole = Extract<ConductorStage, 'detective' | 'strategist' | 'devils-advocate' | 'headsman' | 'auditor' | 'integrator' | 'arbiter' | 'ralph'>

/** Lifecycle and optional gate verdict for one child, never for an entire role. */
export interface ConductorChild {
  /** Concrete session owned by this dispatch. */
  childId: SessionId
  /** Conductor run that dispatched the child. */
  runId: ConductorRunId
  /** Runtime-selected role, independent of prompts and titles. */
  role: ConductorChildRole
  /** One-based attempt for this role within this run. */
  attempt: number
  /** Gate history length when dispatch started; binds only a subsequent verdict. */
  historyOffset: number
  /** Workflow child lifecycle, independent of gate acceptance. */
  status: 'running' | 'completed' | 'failed'
  /** Present only after runtime evaluates this particular specialist's report. */
  gate?: { id: GateId; decision: GateDecision; reworks: number; limit: number }
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Model-hidden child identity/lifecycle/verdict snapshot, keyed by childId. */
    'conductor/child': ConductorChild
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Concrete Conductor children of this parent session, including all attempts. */
    conductorChildren: Record<string, ConductorChild>
  }
}
