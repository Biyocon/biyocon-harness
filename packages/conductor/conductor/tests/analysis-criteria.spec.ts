import { describe, expect, it } from 'vitest'
import { createRun, drive, parseRun, serializeRun } from '../src/index.ts'
import { candidateProblem } from '../src/analysis.ts'
import { acceptedReport, analysisReply, analysisRun } from './intake-fixtures.ts'

describe('analysis acceptance criteria', () => {
  it.each([{ criteria: undefined }, { criteria: [] }])('rejects missing criteria before creating an analysis run: $criteria', ({ criteria }) => {
    const original = analysisRun('detective', 'recommendations')
    expect(() => createRun(original.runId, {
      admission: original.admission,
      objective: original.objective,
      authority: original.authority,
      constraints: ['Describe the structure.', 'Justify three recommendations.'],
      ...criteria === undefined ? {} : { acceptanceCriteria: criteria },
    })).toThrow(/analysis requires at least one acceptanceCriteria.*not constraints/)
  })

  it('rejects an empty criterion list in a durable analysis record', () => {
    const record = { ...analysisRun(), acceptanceCriteria: [] }
    expect(() => parseRun(serializeRun(record))).toThrow(/analysis requires at least one acceptanceCriteria/)
  })

  it.each([[''], [' '], ['A '], ['A', 'A']])('rejects unrestorable analysis criteria at creation: %j', (...criteria) => {
    const run = analysisRun()
    expect(() => createRun(run.runId, {
      admission: run.admission, objective: run.objective, authority: run.authority, acceptanceCriteria: criteria,
    })).toThrow(/analysis acceptanceCriteria must/)
  })

  it.each([
    null,
    { criterion: '', outcome: 'Assessed.' },
    { criterion: ' ', outcome: 'Assessed.' },
    { criterion: 'A', outcome: '' },
    { criterion: 'A', outcome: ' ' },
    { criterion: 'A', outcome: 'Assessed.', extra: true },
  ])('identifies malformed criterion positions and the expected list: %j', (malformed) => {
    const run = { ...analysisRun(), acceptanceCriteria: ['A', 'B'] }
    const candidate = analysisReply(run, 'detective').candidate!
    const problem = candidateProblem({ ...candidate, criteria: [{ criterion: 'A', outcome: 'Assessed.' }, malformed] }, run)
    expect(problem).toContain('Expected acceptance_criteria: ["A","B"]')
    expect(problem).toContain('Malformed criterion/outcome item positions (1-based): [2]')
  })

  it.each([
    { received: ['A', 'C'], missing: ['B'], extra: [], changed: [{ position: 2, expected: 'B', received: 'C' }] },
    { received: ['A', 'B', 'C', 'D'], missing: [], extra: ['D'], changed: [] },
    { received: ['A', 'replacement', 'C'], missing: ['B'], extra: ['replacement'], changed: [{ position: 2, expected: 'B', received: 'replacement' }] },
    { received: ['B', 'A', 'C'], missing: [], extra: [], changed: [{ position: 1, expected: 'A', received: 'B' }, { position: 2, expected: 'B', received: 'A' }] },
    { received: ['A', 'A', 'C'], missing: ['B'], extra: ['A'], changed: [{ position: 2, expected: 'B', received: 'A' }] },
  ])('reports the exact expected list and criterion differences: $received', ({ received, ...difference }) => {
    const run = { ...analysisRun(), acceptanceCriteria: ['A', 'B', 'C'] }
    const candidate = analysisReply(run, 'detective').candidate!
    const problem = candidateProblem({ ...candidate, criteria: received.map(criterion => ({ criterion, outcome: 'Assessed.' })) }, run)
    expect(problem).toContain('Expected acceptance_criteria: ["A","B","C"]')
    expect(problem).toContain(`Differences: ${JSON.stringify(difference)}`)
  })

  it('repairs a criteria mismatch on the first rework and preserves the fixed acceptance list', async () => {
    const original = analysisRun('detective', 'recommendations')
    const run = { ...original, acceptanceCriteria: ['Describe the structure.', 'Justify three recommendations.'] }
    let strategistCalls = 0
    const result = await drive(run, {
      authorizeExecution: () => { throw new Error('An analysis must not ask for approval') },
      dispatchSpecialist(stage, current) {
        const reply = analysisReply(current, stage, `report-${strategistCalls}`)
        if (stage === 'strategist' && strategistCalls++ === 0) {
          reply.candidate!.criteria = [{ criterion: 'Invented criterion', outcome: 'Assessed.' }]
        } else if (stage === 'strategist') {
          expect(current.history.at(-1)?.basis.join('\n')).toContain(JSON.stringify(run.acceptanceCriteria))
          expect(current.history.at(-1)?.basis.join('\n')).toContain('Invented criterion')
        }
        return Promise.resolve(reply)
      },
      dispatchArbiter: current => Promise.resolve(acceptedReport(current)),
    })
    expect(result.kind).toBe('report')
    expect(strategistCalls).toBe(2)
    expect(result.run.history.filter(gate => gate.gate === 'B').map(gate => gate.decision)).toEqual(['rework', 'pass'])
    expect(result.run.acceptanceCriteria).toEqual(run.acceptanceCriteria)
  })
})
