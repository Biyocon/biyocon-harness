/**
 * Conductor-owned host turns and single-use continuation reservations.
 * @module @deepseek-ai/dsh-tool-conductor/owner-controller
 */
import { FiberState } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import { applyScriptedOwnerAnswer, consumeOwnerContinuation, decodeOwnerInteractionEvent, effectiveOwnerMandate, parseRun, pendingOwnerResumePlan, SessionConductorRunStore } from '@deepseek-ai/dsh-conductor'
import { isDeepStrictEqual } from 'node:util'
import type { ConductorRun, ConductorRunId, ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import { OwnerReservations } from './owner-reservation.ts'
import type { OwnerReceipt, OwnerReservation, OwnerTransportBinding } from './owner-reservation.ts'

const SOURCE = '@deepseek-ai/dsh-tool-conductor/owner-controller'

/** A consumed checkpoint whose dispatch must not be guessed or repeated. */
export class OwnerContinuationInterruption extends Error {
  constructor(readonly run: ConductorRun, cause: unknown) {
    super('Conductor owner continuation was interrupted at its consumption boundary; dispatch remains parked and must not be repeated', { cause })
  }
}

/** Explicit test-composition entry; no shipped preset mounts a production answerer. */
export interface ConductorOwnerHostTest {
  kind: 'scripted-test-provider'
  settled: Promise<void>
  interact(controller: ConductorOwnerController, agent: Agent, runId: ConductorRunId, signal: AbortSignal): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    conductorOwnerHostTest?: ConductorOwnerHostTest
  }
}

interface HostTurnState {
  message: UserMessage
  runId: ConductorRunId
  claimed: boolean
  committed: ConductorRun | undefined
  cancelled: boolean
  consuming: boolean
}
type HostTurn = HostTurnState & ({ kind: 'answer'; reservation: OwnerReservation } | { kind: 'continue' })

interface OwnerState {
  reservations: OwnerReservations
  turn: HostTurn | undefined
  interaction: AbortController | undefined
}

interface OwnedInteraction {
  agent: Agent
  abort: AbortController
}

/**
 * Own response turns without changing the generic loop. This capability is held
 * by host code, never obtained from tool arguments, prompt text or source strings.
 */
export class ConductorOwnerController {
  private readonly states = new Map<Agent, OwnerState>()
  private readonly operations = new Map<Promise<unknown>, OwnedInteraction | undefined>()
  private stopping = false

  /**
   * Offer a flushed parked question only to an explicitly mounted scripted host.
   * @param agent - original tool's owning root.
   * @param runId - exact parked run; the tool itself never waits for its own idle.
   */
  offer(agent: Agent, runId: ConductorRunId): void {
    const provider = this.ctx.get('conductorOwnerHostTest')
    if (provider === undefined) return
    // oxlint-disable-next-line typescript/no-unnecessary-condition -- preserve test-only opt-in for untyped plugin registrations.
    if (provider.kind !== 'scripted-test-provider') throw new Error('Conductor production owner answering is not enabled in this build')
    const state = this.state(agent)
    if (state.interaction !== undefined) throw new Error('Conductor already has an owner interaction')
    const interaction = new AbortController()
    state.interaction = interaction
    const operation = (async () => {
      await agent.whenIdle()
      this.live(agent)
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Conductor question could not be flushed before interaction')
      this.live(agent)
      interaction.signal.throwIfAborted()
      await provider.interact(this, agent, runId, interaction.signal)
    })()
    this.operations.set(operation, { agent, abort: interaction })
    const retire = (): void => {
      this.operations.delete(operation)
      if (state.interaction === interaction) state.interaction = undefined
    }
    void operation.then(retire, (error: unknown) => {
      retire()
      this.ctx.logger.warn(`Conductor owner interaction stayed parked: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  constructor(private readonly ctx: Context) {
    ctx.on('agent/inbox/claimed', ({ agent, message }) => {
      const state = this.states.get(agent)
      if (state?.turn?.message.id === message.id && !state.turn.claimed) state.turn.claimed = true
      if (message.source.kind === 'user' && this.phase(agent) !== undefined) {
        // Inbox.claim already removed the item. Reinsert it without waking the
        // driver, so the existing queue stays visible and survives restart.
        agent.inbox.prepend('next-turn', message)
      }
    })
    ctx.on('agent/inbox/discarded', ({ agent, message }) => {
      if (this.states.get(agent)?.turn?.message.id === message.id) this.cancel(agent)
    })
    ctx.on('agent/pre-step', async ({ agent, messages, signal }, next) => {
      const state = this.states.get(agent)
      const turn = state?.turn
      if (state !== undefined && turn !== undefined && turn.claimed && messages.some(message => message.id === turn.message.id)) {
        this.checkTurn(agent, turn, signal)
        const run = await this.load(agent, turn.runId)
        this.checkTurn(agent, turn, signal)
        if (turn.kind === 'answer') {
          const answered = state.reservations.validate(turn.reservation, run)
          await this.store(agent).save(answered, turn.reservation.binding)
          this.checkTurn(agent, turn, signal)
          turn.committed = answered
          return { kind: 'enter', messages: [] }
        }
        const plan = pendingOwnerResumePlan(run)
        if (plan === undefined) {
          throw new Error('Conductor has no unconsumed host continuation')
        }
        turn.committed = run
        // These exact bytes become user/message in this turn; answers never
        // enter the inbox and are projected only from the durable checkpoint.
        return { kind: 'enter', messages: [createUserMessage({ source: { kind: 'plugin', plugin: SOURCE }, content: [{
          type: 'text', text: 'Continue only the stored Conductor run. Call conductor first with its stored admission; '
            + 'do not inspect the workspace or admit a replacement task. An owner answer is not Gate C approval.\n'
            + JSON.stringify({ runId: run.runId, objective: run.objective, admission: run.admission,
              ownerLedger: run.ownerLedger, authority: run.authority, allowedPaths: run.allowedPaths,
              excludedPaths: run.excludedPaths, effectiveMandate: effectiveOwnerMandate(run),
              mandateRevision: plan.mandateRevision,
              gateCApprovalRequired: run.admission.purpose === 'implementation' && run.executionAuthorization === null }),
        }] })] }
      }
      if (this.phase(agent) !== undefined || messages.some(message => message.source.kind === 'plugin' && message.source.plugin === SOURCE)) {
        // A stale queued token has no process-owned reservation after restart.
        // Claiming it removes it durably; it cannot open a model or tool step.
        return { kind: 'reject' }
      }
      return next()
    })
    ctx.on('session/event', (session, event) => {
      if (event.type !== 'turn/end' || event.data.reason.kind === 'completed') return
      for (const [agent, state] of this.states) if (agent.session === session && state.turn?.claimed) {
        this.cancel(agent)
      }
    })
    ctx.on('agent/disposed', ({ agent }) => { this.cancel(agent); this.states.delete(agent) })
    ctx.effect(() => async () => {
      this.stopping = true
      for (const operation of this.operations.values()) operation?.abort.abort()
      for (const [agent, state] of this.states) {
        state.reservations.cancel()
        if (state.turn !== undefined) {
          state.turn.cancelled = true
          agent.cancel({ kind: 'parent' }, { keepInbox: true })
        }
      }
      await Promise.allSettled(this.operations.keys())
      this.states.clear()
    }, 'Conductor owner controller lifecycle')
  }

  private live(agent: Agent): void {
    if (this.stopping || this.ctx.fiber.state !== FiberState.ACTIVE
      || this.ctx.agents.get(agent.id) !== agent || !this.ctx.agents.roots().includes(agent)) {
      throw new Error('Conductor owner interaction requires the exact live owning root session')
    }
  }

  private checkTurn(agent: Agent, turn: HostTurn, signal: AbortSignal): void {
    signal.throwIfAborted()
    this.live(agent)
    if (this.states.get(agent)?.turn !== turn) throw new Error('Conductor host reservation changed or was cancelled')
  }

  private state(agent: Agent): OwnerState {
    this.live(agent)
    let state = this.states.get(agent)
    if (state === undefined) {
      state = { reservations: new OwnerReservations(), turn: undefined, interaction: undefined }
      this.states.set(agent, state)
    }
    return state
  }

  private store(agent: Agent): SessionConductorRunStore {
    return new SessionConductorRunStore(agent.session, async () => {
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Conductor owner checkpoint could not be flushed')
    })
  }

  private requireUnreserved(state: OwnerState): void {
    if (state.turn !== undefined) throw new Error('Conductor already has a host turn reserved')
  }

  private async load(agent: Agent, runId: ConductorRunId): Promise<ConductorRun> {
    const run = await this.store(agent).load(runId)
    if (run === undefined || run.ownerSessionId !== agent.id) throw new Error('Conductor owner run is missing or belongs to another session')
    return run
  }

  /**
   * Read the persisted waiting state, or the one live continuation capability.
   * @param agent - exact parent whose tools are being assembled or executed.
   * @returns a restrictive phase, or undefined for unrelated/completed runs.
   */
  phase(agent: Agent): 'awaiting-owner' | 'reserved-continuation' | undefined {
    const turn = this.states.get(agent)?.turn
    if (turn?.kind === 'continue' && turn.claimed && !turn.cancelled) return 'reserved-continuation'
    const checkpoints = new Set<string>()
    for (const event of agent.session.events.toReversed()) {
      if (event.type !== 'conductor/checkpoint' || checkpoints.has(event.data.runId)) continue
      checkpoints.add(event.data.runId)
      if (event.data.record === null) continue
      const run = parseRun(event.data.record)
      if (run.status === 'awaiting_owner' || run.status === 'continuation_pending') return 'awaiting-owner'
    }
    return undefined
  }

  /**
   * Bind a fresh transport to the same durable question after quiescence and flush.
   * @param agent - live owning root, not a client-supplied session surrogate.
   * @param runId - stored run selected by trusted host interaction code.
   * @returns fresh transport identity; no production answer provider is enabled.
   */
  async reconnect(agent: Agent, runId: ConductorRunId): Promise<OwnerTransportBinding> {
    const state = this.state(agent)
    await agent.whenIdle()
    this.live(agent)
    if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Conductor question is not durably available')
    this.live(agent)
    return state.reservations.reconnect(await this.load(agent, runId))
  }

  /**
   * Reserve and commit a response in a host-only turn, then queue its continuation.
   * @param agent - exact live owner.
   * @param binding - complete host-issued transport identity.
   * @param response - complete response kept privately until the host turn.
   * @param signal - cancellation owned by the host interaction.
   * @returns durable acknowledgement after quiescence and a successful flush.
   */
  respond(agent: Agent, binding: OwnerTransportBinding, response: ScriptedOwnerResponse, signal: AbortSignal): Promise<OwnerReceipt> {
    const operation = this.record(agent, binding, response, signal)
    this.operations.set(operation, undefined)
    const retire = (): void => { this.operations.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }

  private async record(
    agent: Agent, binding: OwnerTransportBinding, response: ScriptedOwnerResponse, signal: AbortSignal,
  ): Promise<OwnerReceipt> {
    signal.throwIfAborted()
    const state = this.state(agent)
    const run = await this.load(agent, binding.runId)
    signal.throwIfAborted()
    this.live(agent)
    const prior = agent.session.events.find(event => (event.type === 'conductor/owner-response-recorded'
      || event.type === 'conductor/owner-terminal-rejection') && event.data.runId === binding.runId
      && event.data.interaction.questionId === binding.questionId)
    if (prior?.type === 'conductor/owner-response-recorded' || prior?.type === 'conductor/owner-terminal-rejection') {
      const fact = decodeOwnerInteractionEvent(prior.type, prior.data)
      if (!run.ownerLedger.some(entry => isDeepStrictEqual(entry, fact.interaction))) {
        throw new Error('Conductor saved receipt contradicts its authoritative ledger')
      }
      if (binding.rootSessionId !== agent.id || !isDeepStrictEqual(prior.data.transport, binding)) {
        throw new Error('Conductor duplicate response has a foreign or stale transport binding')
      }
      applyScriptedOwnerAnswer(run, response)
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Conductor saved receipt could not be flushed')
      signal.throwIfAborted()
      this.live(agent)
      return { runId: run.runId, questionId: binding.questionId, revision: prior.data.interaction.revision,
        status: prior.type === 'conductor/owner-terminal-rejection' ? 'aborted' : 'continuation_pending' }
    }
    const reservation = state.reservations.reserve(run, binding, response)
    const turn: HostTurn = { kind: 'answer', message: createUserMessage({ source: { kind: 'plugin', plugin: SOURCE },
      content: [{ type: 'text', text: `Record owner reservation ${reservation.token}.` }] }),
    reservation, runId: run.runId, claimed: false, committed: undefined, cancelled: false, consuming: false }
    state.turn = turn
    const abort = (): void => { this.cancel(agent) }
    signal.addEventListener('abort', abort, { once: true })
    try {
      this.checkTurn(agent, turn, signal)
      await agent.whenIdle()
      this.checkTurn(agent, turn, signal)
      // An idle next-step wake opens a normal host turn and lets the hook
      // preserve any user message claimed alongside this private reservation.
      agent.send(turn.message, 'next-step', true)
      await agent.whenIdle()
      this.checkTurn(agent, turn, signal)
      if (turn.committed === undefined) throw new Error('Conductor owner response was not committed')
      if (!await this.ctx.sessions.flush(agent.session)) throw new Error('Conductor owner response acknowledgement flush failed')
      this.checkTurn(agent, turn, signal)
      const receipt = state.reservations.acknowledge(reservation, turn.committed)
      state.turn = undefined
      // The answer retires this question before its continuation can ask the
      // next one. Its provider still belongs to operations until teardown.
      state.interaction = undefined
      if (receipt.status === 'continuation_pending') await this.resumePending(agent, run.runId, signal)
      return receipt
    } finally {
      signal.removeEventListener('abort', abort)
      if (state.turn === turn) {
        state.turn = undefined
        state.reservations.cancel()
      }
    }
  }

  /**
   * Explicitly queue an already durable plan; restart and cancellation never call this automatically.
   * @param agent - live owning root.
   * @param runId - exact durable continuation selected by trusted host code.
   * @param signal - cancellation; never schedules a continuation after abort.
   */
  async resumePending(agent: Agent, runId: ConductorRunId, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted()
    const state = this.state(agent)
    this.requireUnreserved(state)
    const run = await this.load(agent, runId)
    signal.throwIfAborted()
    this.live(agent)
    if (run.status !== 'continuation_pending') throw new Error('Conductor has no pending owner continuation')
    await agent.whenIdle()
    signal.throwIfAborted()
    this.live(agent)
    this.requireUnreserved(state)
    const turn: HostTurn = { kind: 'continue', runId, claimed: false, committed: undefined, cancelled: false, consuming: false,
      message: createUserMessage({ source: { kind: 'plugin', plugin: SOURCE },
        content: [{ type: 'text', text: 'Resume the reserved Conductor continuation.' }] }) }
    state.turn = turn
    agent.send(turn.message, 'next-step', true)
  }

  /**
   * Withdraw this controller's live reservation without discarding user work.
   * @param agent - exact root whose host interaction was cancelled.
   */
  cancel(agent: Agent): void {
    const state = this.states.get(agent)
    if (state === undefined) return
    for (const operation of this.operations.values()) if (operation?.agent === agent) operation.abort.abort()
    state.reservations.cancel()
    const turn = state.turn
    if (turn !== undefined) {
      turn.cancelled = true
      state.turn = undefined
      agent.inbox.remove(turn.message.id)
      if (turn.claimed && agent.status === 'running') agent.cancel({ kind: 'parent' }, { keepInbox: true })
    }
  }

  /**
   * Consume only the live reservation's run before any specialist dispatch.
   * @param agent - root making the first constrained Conductor call.
   * @param runId - model argument, which must match the private host reservation.
   * @param signal - execution cancellation, checked across persistence awaits.
   * @returns the consumed durable run, or undefined when no host continuation exists.
   */
  consume(agent: Agent, runId: string | undefined, signal: AbortSignal): Promise<ConductorRun | undefined> {
    const operation = this.consumeReserved(agent, runId, signal)
    this.operations.set(operation, undefined)
    const retire = (): void => { this.operations.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }

  private async consumeReserved(agent: Agent, runId: string | undefined, signal: AbortSignal): Promise<ConductorRun | undefined> {
    const state = this.states.get(agent)
    const turn = state?.turn
    if (state === undefined || turn?.kind !== 'continue' || !turn.claimed || turn.cancelled) return undefined
    if (turn.consuming) throw new Error('Conductor continuation is already reserved for consumption')
    turn.consuming = true
    try {
      this.checkTurn(agent, turn, signal)
      if (runId !== turn.runId || turn.committed === undefined) throw new Error('Conductor call does not match its host continuation')
      const run = await this.load(agent, turn.runId)
      this.checkTurn(agent, turn, signal)
      const plan = pendingOwnerResumePlan(run)
      if (plan === undefined) throw new Error('Conductor continuation is no longer reserved')
      const consumed = consumeOwnerContinuation(run, plan.questionId)
      try {
        await this.store(agent).save(consumed)
        this.checkTurn(agent, turn, signal)
      } catch (error: unknown) {
        throw new OwnerContinuationInterruption(consumed, error)
      }
      state.turn = undefined
      return consumed
    } catch (error: unknown) {
      turn.cancelled = true
      if (state.turn === turn) state.turn = undefined
      throw error
    }
  }
}
