import { describe, expect, it } from 'vitest'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, createRun, serializeRun } from '../src/index.ts'
import { conductorUnavailableRunsProjection } from '../src/run-availability.ts'
import { implementationAdmission } from './intake-fixtures.ts'

describe('saved Conductor run availability', () => {
  it('projects only identity and format, including through seeded-session replay', () => {
    const session = Session.create(SessionId('owner-root'))
    const runId = ConductorRunId('CON-2026-0037')
    const record = JSON.stringify({ recordFormatVersion: 4, privatePayload: 'synthetic secret' })
    session.append('conductor/checkpoint', { runId, record })
    session.append('session/end-seed', {})
    let state = conductorUnavailableRunsProjection.init()
    for (const event of session.events) state = conductorUnavailableRunsProjection.apply(state, event)
    expect(conductorUnavailableRunsProjection.view(state)).toEqual({ [runId]: { format: 4 } })
    expect(JSON.stringify(state)).not.toContain('synthetic secret')
    expect(conductorUnavailableRunsProjection.schema.safeParse(state).success).toBe(true)
    const current = createRun(runId, { ownerSessionId: session.id, admission: implementationAdmission(),
      objective: 'Current synthetic run', authority: { owner: 'user' } })
    session.append('conductor/checkpoint', { runId, record: serializeRun(current) })
    state = conductorUnavailableRunsProjection.apply(state, session.events.at(-1)!)
    expect(state).toEqual({})
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
})
