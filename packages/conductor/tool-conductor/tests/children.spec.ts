import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { WorkflowRunId } from '@deepseek-ai/dsh-workflow'
import type { WorkflowRun } from '@deepseek-ai/dsh-workflow'
import { CONDUCTOR_SESSION_EVENT_TYPES, conductorChildrenProjection } from '@deepseek-ai/dsh-conductor'
import { ANALYSIS_CHALLENGE_SCHEMA, analysisChallengeHash } from '../../conductor/src/analysis-challenge.ts'
import { analysisRun } from '../../conductor/tests/intake-fixtures.ts'
import { observeConductorChildren, publishChildGates } from '../src/children.ts'
import { describe, expect, it } from 'vitest'

describe('concrete Conductor child presentation', () => {
  it.each(['matching', 'hash', 'candidate', 'child', 'attempt'] as const)('publishes only the exact validated challenge: %s', async (match) => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('findings-parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun()
    const childId = SessionId('critic')
    const materialId = run.admission.materials[0].id
    const challenge = ANALYSIS_CHALLENGE_SCHEMA.parse({ run_id: run.runId, purpose: 'analysis',
      candidate_hash: 'a'.repeat(64), candidate_version: 'v1', material_ids: [materialId],
      critic_child_id: childId, critic_attempt: 1, conclusion: 'does_not_hold', defect: 'report',
      summary: 'The alternatives are incomplete.', findings: [{ id: 'alternative', severity: 'major',
        claim: 'A simpler alternative is missing.', rationale: 'The captured material includes it.', material_ids: [materialId] }] })
    const hash = analysisChallengeHash(challenge)
    session.append('conductor/child', { childId, runId: run.runId, role: 'devils-advocate', mode: 'critic',
      attempt: 1, criticAttempt: 1, historyOffset: 0, status: 'completed' })
    publishChildGates(session, { ...run, analysisChallenges: [{ challenge, hash,
      candidateHash: challenge.candidate_hash, criticChildId: childId, criticAttempt: 1, inputTokens: 10, outputTokens: 10 }],
    history: [{ kind: 'evaluated', gate: 'C', stage: 'devils-advocate', decision: 'rework',
      basis: ['Revise the report.'], evidenceReviewed: [], stateUpdate: 'Return to producer.',
      analysis: { mode: 'critic', childId: match === 'child' ? SessionId('other') : childId,
        criticAttempt: match === 'attempt' ? 2 : 1,
        candidateHash: match === 'candidate' ? 'b'.repeat(64) : challenge.candidate_hash,
        challengeHash: match === 'hash' ? 'c'.repeat(64) : hash, conclusion: 'does_not_hold' } }] })
    const event = session.events.findLast(event => event.type === 'conductor/child')!
    if (event.type !== 'conductor/child') throw new Error('Missing child event')
    expect(event.data.gate?.challenge).toEqual(match === 'matching'
      ? { hash, result: challenge } : undefined)
    if (match === 'child' || match === 'attempt') {
      expect(session.events.filter(row => row.type === 'conductor/child')).toHaveLength(1)
      expect(event.data.gate).toBeUndefined()
    } else {
      expect(session.events.filter(row => row.type === 'conductor/child')).toHaveLength(2)
      expect(event.data.gate).toMatchObject({ id: 'C', decision: 'rework', reworks: 1, limit: 2 })
    }
    if (match === 'matching') {
      expect(event.data.gate?.challenge?.result.findings).not.toBe(challenge.findings)
      let state = conductorChildrenProjection.init()
      for (const row of session.events) state = conductorChildrenProjection.apply(state, row)
      expect(conductorChildrenProjection.schema.parse(state)[childId]?.gate?.challenge).toEqual(event.data.gate?.challenge)
    }
    await ctx.fiber.dispose()
  })

  it('does not assign a resumed dispatch verdict to an earlier child without a gate', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('resume-parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun()
    session.append('conductor/child', { childId: SessionId('prior-child'), runId: run.runId, role: 'detective',
      attempt: 1, historyOffset: run.history.length, status: 'completed' })
    const workflow = { id: WorkflowRunId('resumed-detective') } as WorkflowRun
    const stop = observeConductorChildren(ctx, session, workflow, run, 'detective')
    const info = { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }
    const child = { childId: SessionId('detective'), seq: 1, label: 'unrelated' }
    ctx.emit('workflow/agent-start', info, child)
    ctx.emit('workflow/agent-end', info, { ...child, outcome: 'completed' })
    stop()
    publishChildGates(session, { ...run, history: [{ kind: 'evaluated', gate: 'A', stage: 'detective',
      decision: 'pass', basis: ['Report accepted.'], evidenceReviewed: [], stateUpdate: 'Ready for next stage.' }] })
    let state = conductorChildrenProjection.init()
    for (const event of session.events) state = conductorChildrenProjection.apply(state, event)
    expect(state['prior-child']?.gate).toBeUndefined()
    expect(state['detective']).toMatchObject({ attempt: 2, gate: { id: 'A', decision: 'pass' } })
  })

  it('keeps rework attempts separate, including their exact verdict and lifecycle', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun('detective', 'recommendations')
    const detectiveGate = { kind: 'evaluated' as const, gate: 'A' as const, stage: 'detective' as const,
      decision: 'pass' as const, basis: ['Scope accepted.'], evidenceReviewed: [], stateUpdate: 'Ready for plan.' }
    const reworkGate = { kind: 'evaluated' as const, gate: 'B' as const, stage: 'strategist' as const,
      decision: 'rework' as const, defectClass: 'plan' as const, nextStage: 'strategist' as const,
      basis: ['Plan needs revision.'], evidenceReviewed: [], stateUpdate: 'Revise plan.' }
    const passGate = { kind: 'evaluated' as const, gate: 'B' as const, stage: 'strategist' as const,
      decision: 'pass' as const, basis: ['Plan accepted.'], evidenceReviewed: [], stateUpdate: 'Ready for critic.' }
    for (const [index, history] of [[detectiveGate], [detectiveGate, reworkGate]].entries()) {
      const current = { ...run, history }
      const workflow = { id: WorkflowRunId(`workflow-${index}`) } as WorkflowRun
      const stop = observeConductorChildren(ctx, session, workflow, current, 'strategist')
      const child = { childId: SessionId(`child-${index + 1}`), seq: 1, label: 'unrelated prompt text' }
      ctx.emit('workflow/agent-start', { id: WorkflowRunId('another-workflow'), meta: { name: 'other', description: '' } }, child)
      const info = { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }
      ctx.emit('workflow/agent-start', info, child)
      ctx.emit('workflow/agent-end', info, { ...child, outcome: 'completed' })
      stop()
      publishChildGates(session, { ...run, history: [...history, index === 0 ? reworkGate : passGate] })
    }
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
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
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
    ctx.emit('workflow/agent-end', { id: WorkflowRunId('another-workflow'), meta: { name: 'other', description: '' } }, {
      childId: SessionId('failed-child'), seq: 1, label: 'not a role', outcome: 'completed',
    })
    ctx.emit('workflow/agent-end', { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }, {
      childId: SessionId('failed-child'), seq: 1, label: 'not a role', outcome: 'failed',
    })
    stop()
    const final = session.events.at(-1)!
    expect(final.type === 'conductor/child' && final.data).toMatchObject({ status: 'failed', role: 'detective' })
    expect(final.type === 'conductor/child' && final.data.gate).toBeUndefined()
  })

  it('records a critic child with its own mode and run-wide attempt after an entry-C producer', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('entry-c-parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun('devils-advocate', 'answer')
    session.append('conductor/child', { childId: SessionId('other-role'), runId: run.runId,
      role: 'detective', attempt: 1, historyOffset: 0, status: 'completed' })
    session.append('conductor/child', { childId: SessionId('producer'), runId: run.runId,
      role: 'devils-advocate', mode: 'producer', attempt: 1, historyOffset: 0, status: 'completed' })
    const workflow = { id: WorkflowRunId('critic-workflow') } as WorkflowRun
    const stop = observeConductorChildren(ctx, session, workflow, run, 'devils-advocate',
      { mode: 'critic', criticAttempt: 1 })
    const info = { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } }
    const child = { childId: SessionId('critic'), seq: 1, label: 'prompt text' }
    ctx.emit('workflow/agent-start', info, child)
    ctx.emit('workflow/agent-end', info, { ...child, outcome: 'completed' })
    stop()
    const event = session.events.findLast(row => row.type === 'conductor/child')
    expect(event?.type === 'conductor/child' && event.data).toMatchObject({ childId: SessionId('critic'),
      role: 'devils-advocate', mode: 'critic', attempt: 2, criticAttempt: 1, status: 'completed' })
  })

  it('marks an interrupted child failed without fabricating a gate', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('interrupted-parent'))
    session.append('turn/start', { turn: 1 })
    const workflow = { id: WorkflowRunId('interrupted-workflow') } as WorkflowRun
    const stop = observeConductorChildren(ctx, session, workflow, analysisRun(), 'detective')
    ctx.emit('workflow/agent-start', { id: workflow.id, meta: { name: 'conductor-specialist', description: '' } },
      { childId: SessionId('interrupted-child'), seq: 1, label: 'pending' })
    stop()
    const final = session.events.findLast(event => event.type === 'conductor/child')
    expect(final?.type === 'conductor/child' && final.data).toMatchObject({ status: 'failed',
      childId: SessionId('interrupted-child') })
    expect(final?.type === 'conductor/child' && final.data.gate).toBeUndefined()
  })

  it('binds a critic verdict to its exact child and skips a budget escalation without one', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore, { sessionEventTypes: [...CONDUCTOR_SESSION_EVENT_TYPES] })
    const session = ctx.sessions.create(SessionId('critic-gate-parent'))
    session.append('turn/start', { turn: 1 })
    const run = analysisRun('devils-advocate', 'answer')
    const childId = SessionId('critic-child')
    session.append('conductor/child', { childId, runId: run.runId, role: 'devils-advocate',
      mode: 'critic', attempt: 1, criticAttempt: 1, historyOffset: 0, status: 'completed' })
    const gate = { kind: 'evaluated' as const, gate: 'C' as const, stage: 'devils-advocate' as const,
      decision: 'pass' as const, basis: ['Challenge holds.'], evidenceReviewed: [], stateUpdate: 'Critic passed.',
      analysis: { mode: 'critic' as const, candidateHash: 'a'.repeat(64), criticAttempt: 1,
        challengeHash: 'b'.repeat(64), conclusion: 'holds' as const } }
    publishChildGates(session, { ...run, history: [{ ...gate, origin: 'critic-budget' as const }] })
    expect(session.events.filter(event => event.type === 'conductor/child' && event.data.gate !== undefined)).toHaveLength(0)
    publishChildGates(session, { ...run, history: [gate] })
    expect(session.events.filter(event => event.type === 'conductor/child' && event.data.gate !== undefined)).toHaveLength(0)
    publishChildGates(session, { ...run, history: [{ ...gate, analysis: { ...gate.analysis,
      childId: SessionId('foreign-child') } }] })
    expect(session.events.filter(event => event.type === 'conductor/child' && event.data.gate !== undefined)).toHaveLength(0)
    publishChildGates(session, { ...run, history: [{ ...gate, analysis: { ...gate.analysis,
      childId, mode: 'producer' } }] })
    expect(session.events.filter(event => event.type === 'conductor/child' && event.data.gate !== undefined)).toHaveLength(0)
    publishChildGates(session, { ...run, history: [{ ...gate, analysis: { ...gate.analysis, childId } }] })
    const final = session.events.findLast(event => event.type === 'conductor/child')
    expect(final?.type === 'conductor/child' && final.data.gate).toMatchObject({ id: 'C',
      decision: 'pass', challengeConclusion: 'holds' })
  })
})
