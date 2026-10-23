import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import * as ConductorInvariant from '../src/invariant.ts'
import { ConductorRunId, createRun, serializeRun } from '../src/index.ts'

function record(runId = ConductorRunId('CON-2026-0001')): string {
  return serializeRun(createRun(runId, {
    objective: 'validate durable checkpoints',
    authority: { owner: 'user' },
  }))
}

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(ConductorInvariant)
  return ctx
}

describe('dsh-conductor checkpoint invariant', () => {
  it('accepts ordinary events, tombstones, and matching durable checkpoints', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('conductor-invariant-valid'))
    expect(() => session.append('turn/start', { turn: 1 })).not.toThrow()
    expect(() => session.append('conductor/checkpoint', {
      runId: ConductorRunId('CON-2026-0001'),
      record: null,
    })).not.toThrow()
    expect(() => session.append('conductor/checkpoint', {
      runId: ConductorRunId('CON-2026-0001'),
      record: record(),
    })).not.toThrow()
  })

  it('rejects malformed live checkpoints without committing the event', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('conductor-invariant-invalid'))
    expect(() => session.append('conductor/checkpoint', {
      runId: ConductorRunId('CON-2026-0001'),
      record: '{',
    })).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-conductor',
    }))
    expect(session.seq).toBe(0)
  })

  it('rejects a checkpoint whose durable key disagrees with its record', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('conductor-invariant-key'))
    expect(() => session.append('conductor/checkpoint', {
      runId: ConductorRunId('CON-2026-0002'),
      record: record(),
    })).toThrow(/checkpoint key CON-2026-0002 does not match record CON-2026-0001/)
  })

  it('validates checkpoints that predate companion installation', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('conductor-invariant-existing'))
    session.append('turn/start', { turn: 1 })
    session.append('conductor/checkpoint', {
      runId: ConductorRunId('CON-2026-0001'),
      record: record(),
    })
    await ctx.plugin(InvariantRegistry, { enabled: true })
    await expect(ctx.plugin(ConductorInvariant)).resolves.toBeDefined()
  })
})
