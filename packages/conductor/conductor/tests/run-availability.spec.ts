import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import SessionProjections from '@deepseek-ai/dsh-session-projection'
import * as Conductor from '../src/index.ts'
import { ConductorRunId, createRun, serializeRun, SessionConductorRunStore } from '../src/index.ts'
import { conductorUnavailableRunsProjection } from '../src/run-availability.ts'
import { implementationAdmission } from './intake-fixtures.ts'

describe('saved Conductor run availability', () => {
  it('projects only identity and format through the registered seeded-session replay', async () => {
    const session = Session.create(SessionId('owner-root'))
    const runId = ConductorRunId('CON-2026-0037')
    const record = JSON.stringify({ recordFormatVersion: 4, privatePayload: 'synthetic secret' })
    session.append('conductor/checkpoint', { runId, record })
    session.append('session/end-seed', {})
    const ctx = new Context()
    await ctx.plugin(SessionProjections)
    await ctx.plugin(Conductor)
    const replayed = Session.create(session.id, session.events)
    const snapshot = ctx.sessionProjections.snapshot(replayed)
    expect(snapshot.values.conductorUnavailableRuns).toEqual({ [runId]: { format: 4 } })
    expect(ctx.sessionProjections.checkpoint(replayed).conductorUnavailableRuns?.val).toEqual({ [runId]: { format: 4 } })
    let state = conductorUnavailableRunsProjection.init()
    for (const event of session.events) state = conductorUnavailableRunsProjection.apply(state, event)
    expect(JSON.stringify(state)).not.toContain('synthetic secret')
    expect(conductorUnavailableRunsProjection.schema.safeParse(state).success).toBe(true)
    const current = createRun(runId, { ownerSessionId: session.id, admission: implementationAdmission(),
      objective: 'Current synthetic run', authority: { owner: 'user' } })
    session.append('conductor/checkpoint', { runId, record: serializeRun(current) })
    state = conductorUnavailableRunsProjection.apply(state, session.events.at(-1)!)
    expect(state).toEqual({})
    await ctx.fiber.dispose()
  })

  it('reports unknown format for invalid JSON and clears on tombstone', () => {
    const session = Session.create(SessionId('owner-root'))
    const runId = ConductorRunId('CON-2026-0037')
    session.append('conductor/checkpoint', { runId, record: '{' })
    let state = conductorUnavailableRunsProjection.apply(conductorUnavailableRunsProjection.init(), session.events.at(-1)!)
    expect(state).toEqual({ [runId]: { format: null } })
    session.append('conductor/checkpoint', { runId, record: null })
    state = conductorUnavailableRunsProjection.apply(state, session.events.at(-1)!)
    expect(state).toEqual({})
  })

  it('keeps the same state reference when clearing an absent run', () => {
    const session = Session.create(SessionId('owner-root'))
    const state = conductorUnavailableRunsProjection.init()
    const runId = ConductorRunId('CON-2026-0037')
    session.append('conductor/checkpoint', { runId, record: null })
    expect(conductorUnavailableRunsProjection.apply(state, session.events.at(-1)!)).toBe(state)
    session.append('conductor/checkpoint', { runId, record: serializeRun(createRun(runId, {
      ownerSessionId: session.id, admission: implementationAdmission(), objective: 'Synthetic', authority: { owner: 'user' },
    })) })
    expect(conductorUnavailableRunsProjection.apply(state, session.events.at(-1)!)).toBe(state)
  })

  it('leaves owner-mismatched current records to the strict store because events carry no session id', async () => {
    const session = Session.create(SessionId('owner-root'))
    const runId = ConductorRunId('CON-2026-0037')
    const run = createRun(runId, { ownerSessionId: SessionId('another-root'), admission: implementationAdmission(),
      objective: 'Synthetic', authority: { owner: 'user' } })
    session.append('conductor/checkpoint', { runId, record: serializeRun(run) })
    const state = conductorUnavailableRunsProjection.apply(conductorUnavailableRunsProjection.init(), session.events.at(-1)!)
    expect(state).toEqual({})
    await expect(new SessionConductorRunStore(session, () => Promise.resolve()).load(runId))
      .rejects.toThrow('cannot be resumed (format 5)')
  })
})
