import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { conductorChildrenProjection, drive } from '@deepseek-ai/dsh-conductor'
import { acceptedReport, analysisReply, analysisRun } from '../../conductor/tests/intake-fixtures.ts'
import { observeConductorChildren, publishChildGates } from '../src/children.ts'
import { describe, expect, it } from 'vitest'

describe('concrete Conductor child presentation', () => {
  it('does not assign a resumed dispatch verdict to an earlier child without a gate', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('resume-parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun()
    session.append('conductor/child', { childId: SessionId('prior-child'), runId: run.runId, role: 'detective',
      attempt: 1, historyOffset: run.history.length, status: 'completed' })
    await drive(run, {
      authorizeExecution: () => { throw new Error('No approval for analysis') },
      async dispatchSpecialist(stage, current) {
        const workflow = { id: WorkflowRunId(stage) } as WorkflowRun
        const stop = observeConductorChildren(ctx, session, workflow, current, stage as 'detective' | 'auditor')
        const info = { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }
        const child = { childId: SessionId(stage), seq: 1, label: 'unrelated' }
        ctx.emit('workflow/agent-start', info, child)
        ctx.emit('workflow/agent-end', info, { ...child, outcome: 'completed' })
        stop()
        return analysisReply(current, stage, 'v1')
      },
      dispatchArbiter: current => Promise.resolve(acceptedReport(current)),
    }, (current) => { publishChildGates(session, current); return Promise.resolve() })
    let state = conductorChildrenProjection.init()
    for (const event of session.events) state = conductorChildrenProjection.apply(state, event)
    expect(state['prior-child']?.gate).toBeUndefined()
    expect(state['detective']).toMatchObject({ attempt: 2, gate: { id: 'A', decision: 'pass' } })
  })

  it('keeps rework attempts separate, including their exact verdict and lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('parent'))
    session.append('turn/start', { turn: 1 })
    let attempt = 0
    await drive(analysisRun('detective', 'recommendations'), {
      authorizeExecution: () => { throw new Error('No approval for analysis') },
      async dispatchSpecialist(stage, run) {
        const workflow = { id: WorkflowRunId(`workflow-${attempt}`) } as WorkflowRun
        const stop = observeConductorChildren(ctx, session, workflow, run, stage as 'detective' | 'strategist' | 'auditor')
        const child = { childId: SessionId(`child-${attempt++}`), seq: 1, label: 'unrelated prompt text' }
        ctx.emit('workflow/agent-start', { id: WorkflowRunId('another-workflow'), meta: { name: 'other', description: '' } }, child)
        const info = { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }
        ctx.emit('workflow/agent-start', info, child)
        const reply = analysisReply(run, stage, `v${attempt}`)
        if (stage === 'strategist' && attempt === 2) reply.candidate!.criteria = []
        ctx.emit('workflow/agent-end', info, { ...child, outcome: 'completed' })
        stop()
        return reply
      },
      dispatchArbiter: run => Promise.resolve(acceptedReport(run)),
    }, (run) => { publishChildGates(session, run); return Promise.resolve() })
    let state = conductorChildrenProjection.init()
    for (const event of session.events) state = conductorChildrenProjection.apply(state, event)
    const children = Object.values(conductorChildrenProjection.view(state))
    const strategist = children.filter(child => child.role === 'strategist')
    expect(strategist.map(child => [child.childId, child.attempt, child.status, child.gate?.decision])).toEqual([
      ['child-1', 1, 'completed', 'rework'], ['child-2', 2, 'completed', 'pass'],
    ])
    expect(strategist[0]?.gate).toMatchObject({ id: 'B', reworks: 1, limit: 2 })
  })

  it('records a failed child without inventing a gate result', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('parent-failed'))
    session.append('turn/start', { turn: 1 })
    const workflow = { id: WorkflowRunId('failed-workflow') } as WorkflowRun
    const stop = observeConductorChildren(ctx, session, workflow, analysisRun(), 'detective')
    ctx.emit('workflow/agent-end', { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }, {
      childId: SessionId('unrelated-child'), seq: 1, label: 'unrelated', outcome: 'completed',
    })
    ctx.emit('workflow/agent-start', { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }, {
      childId: SessionId('failed-child'), seq: 1, label: 'not a role',
    })
    stop()
    const final = session.events.at(-1)!
    expect(final.type === 'conductor/child' && final.data).toMatchObject({ status: 'failed', role: 'detective' })
    expect(final.type === 'conductor/child' && final.data.gate).toBeUndefined()
  })
})
