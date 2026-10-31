/**
 * Process-local reservations for exact, durable Conductor owner questions.
 * @module @deepseek-ai/dsh-tool-conductor/owner-reservation
 */
import { randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { applyScriptedOwnerAnswer, pendingOwnerQuestion } from '@deepseek-ai/dsh-conductor'
import type { ConductorRun, ConductorRunId, ScriptedOwnerResponse, OwnerTransportBinding } from '@deepseek-ai/dsh-conductor'
export type { OwnerTransportBinding } from '@deepseek-ai/dsh-conductor'

/** Validated answer retained privately until its host turn commits. */
export interface OwnerReservation {
  readonly token: string
  readonly binding: OwnerTransportBinding
  readonly response: ScriptedOwnerResponse
  readonly proposed: ConductorRun
}

/** One recorded response and its stable durable acknowledgement. */
export interface OwnerReceipt {
  runId: ConductorRunId
  questionId: string
  revision: number
  status: 'continuation_pending' | 'aborted'
}

/**
 * Reserve one response for an exact transport and question. No method dispatches work.
 * The controller owns a separate instance for each live root lifecycle; restarting
 * intentionally loses uncommitted tokens while durable receipts remain derivable.
 */
export class OwnerReservations {
  private current: OwnerTransportBinding | undefined
  private reserved: OwnerReservation | undefined

  /**
   * Issue a fresh transport identity without changing the durable question.
   * @param run - authoritative parked run loaded in its owning session.
   * @returns the newly captured transport binding.
   */
  reconnect(run: ConductorRun): OwnerTransportBinding {
    if (this.reserved !== undefined) throw new Error('Conductor owner response is already reserved')
    const question = pendingOwnerQuestion(run)
    if (run.status !== 'awaiting_owner' || question === undefined || run.ownerSessionId === null) {
      throw new Error('Conductor has no pending owner question')
    }
    this.current = { runId: run.runId, questionId: question.id, rootSessionId: run.ownerSessionId,
      revision: run.ownerRevision, transportId: randomUUID() }
    return { ...this.current }
  }

  /**
   * Validate transport identity and reserve exactly one complete response.
   * @param run - latest authoritative checkpoint, never a client-supplied record.
   * @param binding - submitted root, run, question, revision and transport identity.
   * @param response - complete owner response received through the interaction transport.
   * @returns an opaque reservation; no answer is written to an inbox here.
   */
  reserve(run: ConductorRun, binding: OwnerTransportBinding, response: ScriptedOwnerResponse): OwnerReservation {
    if (this.current === undefined || !isDeepStrictEqual(binding, this.current)
      || run.runId !== binding.runId || run.ownerSessionId !== binding.rootSessionId
      || run.ownerRevision !== binding.revision || response.rootSessionId !== binding.rootSessionId
      || response.questionId !== binding.questionId || response.expectedRevision !== binding.revision) {
      throw new Error('Conductor owner response has a foreign or stale transport binding')
    }
    if (this.reserved !== undefined) throw new Error('Conductor owner question already has a reserved response')
    const proposed = applyScriptedOwnerAnswer(run, response)
    const reservation: OwnerReservation = { token: randomUUID(), binding: { ...binding },
      response: structuredClone(response), proposed }
    this.reserved = reservation
    return reservation
  }

  /**
   * Require the exact process-owned reservation immediately before a host-turn write.
   * @param reservation - private object captured before queuing the neutral message.
   * @param run - authoritative run reread at this persistence boundary.
   * @returns validated next checkpoint without mutating the old record.
   */
  validate(reservation: OwnerReservation, run: ConductorRun): ConductorRun {
    if (this.reserved !== reservation || this.current === undefined
      || !isDeepStrictEqual(reservation.binding, this.current)
      || run.runId !== reservation.binding.runId || run.ownerRevision !== reservation.binding.revision
      || run.ownerSessionId !== reservation.binding.rootSessionId) {
      throw new Error('Conductor owner reservation is stale, forged or already consumed')
    }
    return applyScriptedOwnerAnswer(run, reservation.response)
  }

  /**
   * Retire a reservation only after the response checkpoint has been flushed.
   * @param reservation - exact reservation used by the completed host turn.
   * @param run - durably saved response checkpoint.
   * @returns stable acknowledgement, with no continuation dispatch.
   */
  acknowledge(reservation: OwnerReservation, run: ConductorRun): OwnerReceipt {
    if (this.reserved !== reservation || !isDeepStrictEqual(run, reservation.proposed)
      || (run.status !== 'continuation_pending' && run.status !== 'aborted')) {
      throw new Error('Conductor owner response cannot be acknowledged before its exact checkpoint')
    }
    this.cancel()
    return { runId: run.runId, questionId: reservation.binding.questionId,
      revision: run.ownerRevision, status: run.status }
  }

  /** Invalidate in-memory authority on cancellation, disposal or transport replacement. */
  cancel(): void {
    this.reserved = undefined
    this.current = undefined
  }
}
