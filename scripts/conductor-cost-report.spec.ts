import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { aggregateCostTrials, analyzeCostTrial, offPeakNanodollars, type MeasurementArtifact } from './conductor-cost-report.ts'

const sha = (value: string) => createHash('sha256').update(value).digest('hex')
const usage = { inputTokens: 100, cacheReadTokens: 200, outputTokens: 40, reasoningTokens: 30 }

function fixture(kind: 'capture' | 'discovery' = 'capture') {
  const content = 'ordinary\nCRITICAL-ALPHA: synthetic defect\n'
  const material = { id: 'saved-file', kind: 'file', selector: 'archive-alpha.txt', content, sha256: sha(content) }
  const files = [{ path: material.selector, bytes: Buffer.byteLength(content), sha256: material.sha256 }]
  const expected = [{ id: 'CRITICAL-ALPHA', path: material.selector, line: 2 }]
  const world = { caseId: kind, files, expected, worldManifestHash: sha(JSON.stringify({ files, expected })) }
  const manifest: MeasurementArtifact['manifest'] = { caseId: kind, variant: 'candidate', repetition: 1, expectedHead: 'candidate-head',
    prepareOnly: false, worldManifestHash: world.worldManifestHash }
  const raw: MeasurementArtifact & { run: NonNullable<MeasurementArtifact['run']> } = {
    manifest, driverSha256: 'public-driver', startedAt: '2026-11-11T04:00:00.000Z', endedAt: '2026-11-11T04:01:00.000Z',
    stopped: { reason: null as string | null },
    requests: [{ sequence: 1, sessionId: 'producer', turn: 1, step: 1, usage: { ...usage },
      issuedAt: '2026-11-11T04:00:01.000Z', finishedAt: '2026-11-11T04:00:10.000Z', model: 'deepseek-flash', provider: 'deepseek-official',
      systemChars: 10, historyChars: 100, toolResultChars: 0, repeatedToolResultChars: 0,
      request: { messages: [{ role: 'user', content: [{ type: 'text', text: 'Captured source: ' + JSON.stringify(content) }] }] } }],
    sessions: [
      { header: { id: 'public-cost-parent' }, events: [{ type: 'conductor/child', data: { childId: 'producer', role: 'detective' } }] },
      { header: { id: 'producer' }, events: [{ type: 'assistant/message', data: { turn: 1, step: 1, usage: { ...usage } } }] },
    ],
    run: { status: 'reported', reportDecision: { decision: 'accept' }, admission: { materials: [material] },
      history: [{ decision: 'pass' }], reportCandidates: [{ producerChildId: 'producer', candidate: {
        content: '| CRITICAL-ALPHA | archive-alpha.txt | 2 |',
        material_spans: [{ material_id: material.id, start_line: 2, end_line: 2 }],
      } }] },
  }
  return { raw, world, material }
}

function tool(f: ReturnType<typeof fixture>, name: string, text: string, isError = false) {
  const session = f.raw.sessions[1]!
  const existing: unknown[] = session.events
  existing.push({ type: 'tool/call', data: { callId: 'call-1', name, arguments: JSON.stringify({ file_path: 'archive-alpha.txt' }) } },
    { type: 'tool/result', data: { message: { role: 'user', content: [{ type: 'tool-result', toolCallId: 'call-1', isError, content: [{ type: 'text', text }] }] } } })
  const input: unknown[] = f.raw.requests[0]!.request.messages[0]!.content
  input.push({ type: 'tool-result', toolCallId: 'call-1', isError, content: [{ type: 'text', text }] })
}

describe('public cost accounting', () => {
  it('charges disjoint input and inclusive output once, without adding reasoning', () => {
    expect(offPeakNanodollars(usage)).toBe(39600)
    expect(offPeakNanodollars({ ...usage, reasoningTokens: 0 })).toBe(39600)
  })

  it('keeps missing usage and unpriced cache writes unknown', () => {
    expect(offPeakNanodollars(null)).toBeNull()
    expect(offPeakNanodollars({ inputTokens: 1, outputTokens: 1 })).toBeNull()
    expect(offPeakNanodollars({ ...usage, cacheWriteTokens: 1 })).toBeNull()
  })

  it.each([-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid token count %s', (count) => {
    expect(() => offPeakNanodollars({ ...usage, inputTokens: count })).toThrow()
  })

  it('rejects reasoning beyond output and unsafe price arithmetic', () => {
    expect(() => offPeakNanodollars({ ...usage, reasoningTokens: 41 })).toThrow('Reasoning')
    expect(() => offPeakNanodollars({ ...usage, inputTokens: Number.MAX_SAFE_INTEGER })).toThrow('safe integer')
  })

  it('requires exact locations, observed source support and valid saved-source spans', () => {
    const f = fixture()
    const report = analyzeCostTrial(f.raw, f.world, true)
    expect(report).toMatchObject({ validCompletion: true, expectedFindings: 1, locatedFindings: 1,
      supportedFindings: 1, validSavedSpans: 1, offPeakEquivalentUSD: 0.0000396,
      tokens: { cacheWriteUnreportedCalls: 1 }, ledgerMatches: true })
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(f.material.content)
    expect(serialized).not.toContain('archive-alpha.txt')
    expect(serialized).not.toContain('producer')
  })

  it('does not let model acceptance, a request assertion, or its own structured output supply evidence', () => {
    const f = fixture()
    f.raw.requests[0]!.request.messages[0]!.content[0]!.text = 'Please report CRITICAL-ALPHA at archive-alpha.txt line 2'
    tool(f, 'structured_output', f.material.content)
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ accepted: true, validCompletion: false, supportedFindings: 0 })
  })

  it('requires a successful capture page with matching hash, identity, text and range', () => {
    const f = fixture()
    f.raw.requests[0]!.request.messages[0]!.content[0]!.text = 'File index without bodies'
    tool(f, 'conductor_read_capture', JSON.stringify({ material_id: f.material.id, selector: f.material.selector,
      sha256: f.material.sha256, start_line: 2, end_line: 2, lines: ['CRITICAL-ALPHA: synthetic defect'] }))
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: true, tools: {
      conductor_read_capture: { calls: 1, errors: 0 },
    } })
    const bad = structuredClone(f.raw)
    type ToolEvent = { type: string; data: { message?: { content: Array<{ content: Array<{ text: string }> }> } } }
    const events = bad.sessions[1]!.events as unknown as ToolEvent[]
    const result = events.find(event => event.type === 'tool/result')!.data.message!.content[0]!.content[0]!
    result.text = result.text.replace(f.material.sha256, 'wrong-hash')
    expect(analyzeCostTrial(bad, f.world, true).supportedFindings).toBe(0)
  })

  it('does not count workspace reads as captured-version evidence', () => {
    const f = fixture()
    f.raw.requests[0]!.request.messages[0]!.content[0]!.text = 'File index without bodies'
    tool(f, 'read', '2: CRITICAL-ALPHA: synthetic defect')
    expect(analyzeCostTrial(f.raw, f.world, true).validCompletion).toBe(false)
  })

  it('counts a successful workspace observation for discovery without fabricating a saved span', () => {
    const f = fixture('discovery')
    f.raw.run.admission.materials = []
    f.raw.run.reportCandidates[0]!.candidate.material_spans = []
    tool(f, 'read', '2: CRITICAL-ALPHA: synthetic defect')
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: true, validSavedSpans: null })
  })

  it('does not count denied tool results as observations', () => {
    const f = fixture('discovery')
    f.raw.run.admission.materials = []
    tool(f, 'read', '2: CRITICAL-ALPHA: synthetic defect', true)
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: false, supportedFindings: 0,
      tools: { read: { calls: 1, errors: 1 } } })
  })

  it('keeps stopped, unpriced or source-modifying trials out of valid completions while retaining known charges', () => {
    const f = fixture()
    f.raw.stopped.reason = 'wall-clock-limit'
    const report = analyzeCostTrial(f.raw, f.world, false)
    expect(report.validCompletion).toBe(false)
    expect(report.knownOffPeakEquivalentUSD).toBeGreaterThan(0)
    expect(report.failures).toEqual(expect.arrayContaining(['external measurement stop', 'source hashes changed']))
  })

  it('detects usage drift between stream and session and duplicate call identities', () => {
    const f = fixture()
    f.raw.sessions[1]!.events[0]!.data.usage!.outputTokens++
    expect(analyzeCostTrial(f.raw, f.world, true).ledgerMatches).toBe(false)
    f.raw.requests.push(structuredClone(f.raw.requests[0]!))
    f.raw.requests[1]!.sequence = 2
    expect(() => analyzeCostTrial(f.raw, f.world, true)).toThrow('Duplicate model-call')
  })

  it('rejects fabricated source manifests and preparation-only artifacts', () => {
    const f = fixture()
    f.world.expected[0]!.line++
    expect(() => analyzeCostTrial(f.raw, f.world, true)).toThrow('manifest')
    f.raw.manifest.prepareOnly = true
    expect(() => analyzeCostTrial(f.raw, fixture().world, true)).toThrow('Preparation')
  })

  it('rejects wrong report locations, unsupported spans and invented critical identifiers', () => {
    const f = fixture()
    f.raw.run.reportCandidates[0]!.candidate.content = '| CRITICAL-ALPHA | archive-alpha.txt | 200 | CRITICAL-INVENTED |'
    f.raw.run.reportCandidates[0]!.candidate.material_spans[0]!.end_line = 1
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: false,
      locatedFindings: 0, validSavedSpans: 0, unexpectedIdentifierCount: 1 })
  })

  it('binds grep text to its own path heading rather than an unrelated file in the same result', () => {
    const f = fixture('discovery')
    f.raw.run.admission.materials = []
    tool(f, 'grep', 'archive-alpha.txt\nLine 20: harmless\n\nother-file.txt\nLine 2: CRITICAL-ALPHA: synthetic defect')
    expect(analyzeCostTrial(f.raw, f.world, true).supportedFindings).toBe(0)
    const good = fixture('discovery')
    good.raw.run.admission.materials = []
    tool(good, 'grep', 'Showing a saved search page\n\narchive-alpha.txt:2: CRITICAL-ALPHA: synthetic defect')
    expect(analyzeCostTrial(good.raw, good.world, true).supportedFindings).toBe(1)
  })

  it('does not apply Flash prices to another model', () => {
    const f = fixture()
    f.raw.requests[0]!.model = 'another-model'
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: false,
      offPeakEquivalentUSD: null, unpricedCalls: 1 })
  })

  it('checks source-result caps only for Detective and keeps other roles separate', () => {
    const f = fixture()
    tool(f, 'grep', 'x'.repeat(4001))
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: false, detectiveResultsAbove4000: 1,
      toolResults: [{ role: 'detective', tool: 'grep', chars: 4001, error: false }] })
    f.raw.sessions[0]!.events[0]!.data.role = 'auditor'
    expect(analyzeCostTrial(f.raw, f.world, true)).toMatchObject({ validCompletion: true, detectiveResultsAbove4000: 0 })
  })

  it('counts the price of an uncompleted attempt when computing cost per qualified report', () => {
    const f = fixture()
    const complete = analyzeCostTrial(f.raw, f.world, true)
    f.raw.manifest.repetition = 2
    f.raw.run.status = 'awaiting_owner'
    const parked = analyzeCostTrial(f.raw, f.world, true)
    const group = aggregateCostTrials([complete, parked]).groups[0]!
    expect(group).toMatchObject({ trials: 2, oracleQualifiedCompletions: 1,
      totalOffPeakEquivalentUSD: 0.0000792, totalCostPerQualifiedReportUSD: 0.0000792 })
  })

  it('propagates unknown prices and rejects duplicate trials or mixed measurement drivers', () => {
    const f = fixture()
    const complete = analyzeCostTrial(f.raw, f.world, true)
    const unknown = { ...complete, repetition: 2, validCompletion: false, offPeakEquivalentUSD: null,
      unpricedCalls: 1, knownOffPeakEquivalentUSD: 0 }
    expect(aggregateCostTrials([complete, unknown]).groups[0]).toMatchObject({ totalOffPeakEquivalentUSD: null,
      knownOffPeakEquivalentUSD: 0.0000396, totalCostPerQualifiedReportUSD: null })
    expect(() => aggregateCostTrials([complete, complete])).toThrow('Duplicate trial')
    expect(() => aggregateCostTrials([complete, { ...unknown, driverSha256: 'different' }])).toThrow('Mixed measurement')
  })

  it('requires source results to have reached a model request, not merely to exist later in the log', () => {
    const f = fixture('discovery')
    f.raw.run.admission.materials = []
    tool(f, 'read', '2: CRITICAL-ALPHA: synthetic defect')
    f.raw.requests[0]!.request.messages[0]!.content.pop()
    expect(analyzeCostTrial(f.raw, f.world, true).supportedFindings).toBe(0)
  })

  it('rejects missing, duplicate or orphaned durable identities', () => {
    const missingParent = fixture()
    missingParent.raw.sessions.shift()
    expect(() => analyzeCostTrial(missingParent.raw, missingParent.world, true)).toThrow('Missing parent')
    const duplicateMessage = fixture()
    duplicateMessage.raw.sessions[1]!.events.push(structuredClone(duplicateMessage.raw.sessions[1]!.events[0]!))
    expect(() => analyzeCostTrial(duplicateMessage.raw, duplicateMessage.world, true)).toThrow('Duplicate logged')
    const call = fixture()
    tool(call, 'read', 'ordinary')
    const event = call.raw.sessions[1]!.events.find(event => event.type === 'tool/call')!
    const incomplete = structuredClone(call.raw)
    delete incomplete.sessions[1]!.events.find(event => event.type === 'tool/call')!.data.arguments
    expect(() => analyzeCostTrial(incomplete, call.world, true)).toThrow('Incomplete tool')
    call.raw.sessions[1]!.events.push(structuredClone(event))
    expect(() => analyzeCostTrial(call.raw, call.world, true)).toThrow('Duplicate tool')
    const orphan = fixture()
    tool(orphan, 'read', 'ordinary')
    delete orphan.raw.sessions[1]!.events.find(event => event.type === 'tool/result')!.data.message!.content[0]!.toolCallId
    expect(() => analyzeCostTrial(orphan.raw, orphan.world, true)).toThrow('no matching call')
  })

  it('reports absent usage and missing reasoning without assigning a zero price', () => {
    const f = fixture()
    f.raw.requests[0]!.usage = null
    delete f.raw.sessions[1]!.events[0]!.data.usage
    const absent = analyzeCostTrial(f.raw, f.world, true)
    expect(absent).toMatchObject({ validCompletion: false, offPeakEquivalentUSD: null,
      unpricedCalls: 1, tokens: { reasoningMissingCalls: 1 } })
    const partial = fixture()
    delete partial.raw.requests[0]!.usage!.cacheReadTokens
    delete partial.raw.requests[0]!.usage!.reasoningTokens
    partial.raw.requests[0]!.usage!.cacheWriteTokens = 0
    partial.raw.sessions[1]!.events[0]!.data.usage = { ...partial.raw.requests[0]!.usage! }
    expect(analyzeCostTrial(partial.raw, partial.world, true)).toMatchObject({ offPeakEquivalentUSD: null,
      tokens: { cacheWriteUnreportedCalls: 0, reasoningMissingCalls: 1 } })
  })

  it('keeps incomplete, empty and unlinked artifacts visible as failed attempts', () => {
    const f = fixture()
    const incomplete: MeasurementArtifact = structuredClone(f.raw)
    delete incomplete.run
    expect(analyzeCostTrial(incomplete, f.world, true)).toMatchObject({ validCompletion: false, status: 'not-started', rework: 0 })
    const noReport = structuredClone(f.raw)
    noReport.run.reportCandidates = []
    noReport.run.reportDecision = null
    expect(analyzeCostTrial(noReport, f.world, true)).toMatchObject({ validCompletion: false, locatedFindings: 0 })
    f.raw.requests[0]!.sequence = 9
    expect(() => analyzeCostTrial(f.raw, f.world, true)).toThrow('not contiguous')
    const missingLog = fixture()
    missingLog.raw.sessions[1]!.events = []
    expect(analyzeCostTrial(missingLog.raw, missingLog.world, true).ledgerMatches).toBe(false)
    const unlinked = fixture()
    unlinked.raw.requests[0]!.sessionId = 'unknown-child'
    expect(analyzeCostTrial(unlinked.raw, unlinked.world, true).calls[0]!.role).toBe('auxiliary/unknown')
  })

  it('counts parent tool results and ignores non-result and empty blocks without printing content', () => {
    const f = fixture()
    tool(f, 'read', 'ordinary')
    const events = f.raw.sessions[1]!.events.splice(1)
    f.raw.sessions[0]!.events.push(...events,
      { type: 'tool/result', data: {} },
      { type: 'tool/result', data: { message: { role: 'user', content: [{ type: 'text' }] } } })
    const result = f.raw.sessions[0]!.events.find(event => event.type === 'tool/result')!
    result.data.message!.content[0]!.content = [{ type: 'text' }, { type: 'image' }]
    expect(analyzeCostTrial(f.raw, f.world, true).toolResults).toEqual([{ role: 'parent', tool: 'read', chars: 0, error: false, modelCall: null }])
    const aux = fixture()
    tool(aux, 'read', 'ordinary')
    aux.raw.sessions[0]!.events = []
    expect(analyzeCostTrial(aux.raw, aux.world, true).toolResults[0]!.role).toBe('auxiliary/unknown')
  })

  it('preserves missing source text and unmatched step metadata rather than fabricating observations', () => {
    const f = fixture()
    delete f.raw.requests[0]!.request.messages[0]!.content[0]!.text
    expect(analyzeCostTrial(f.raw, f.world, true).supportedFindings).toBe(0)
    tool(f, 'read', 'ordinary')
    const result = f.raw.sessions[1]!.events.find(event => event.type === 'tool/result')!
    delete result.data.message!.content[0]!.content
    result.data.turn = 1
    result.data.step = 99
    expect(analyzeCostTrial(f.raw, f.world, true).toolResults).toEqual([{ role: 'detective', tool: 'read', chars: 0, error: false, modelCall: null }])
  })

  it('includes parent model usage in full-run price and classifies it separately', () => {
    const f = fixture()
    f.raw.requests.push({ ...structuredClone(f.raw.requests[0]!), sequence: 2, sessionId: 'public-cost-parent', reasoningEffort: 'high' })
    f.raw.sessions[0]!.events.push({ type: 'assistant/message', data: { turn: 1, step: 1, usage: { ...usage } } })
    const report = analyzeCostTrial(f.raw, f.world, true)
    expect(report.calls[1]!.role).toBe('parent')
    expect(report.calls[1]!.reasoningEffort).toBe('high')
    expect(report).toMatchObject({ validCompletion: true, modelCalls: 2, offPeakEquivalentUSD: 0.0000792 })
  })

  it('rejects unparseable capture pages, unrelated observations and invalid discovery arguments', () => {
    const f = fixture()
    f.raw.requests[0]!.request.messages[0]!.content[0]!.text = 'index'
    tool(f, 'conductor_read_capture', '{invalid-json')
    expect(analyzeCostTrial(f.raw, f.world, true).supportedFindings).toBe(0)
    const unrelated = fixture()
    unrelated.raw.requests[0]!.request.messages[0]!.content[0]!.text = 'index'
    tool(unrelated, 'conductor_read_capture', '{}')
    unrelated.raw.sessions[0]!.events.push(...unrelated.raw.sessions[1]!.events.splice(1))
    expect(analyzeCostTrial(unrelated.raw, unrelated.world, true).supportedFindings).toBe(0)
    const discovery = fixture('discovery')
    discovery.raw.run.admission.materials = []
    tool(discovery, 'glob', 'CRITICAL-ALPHA')
    expect(analyzeCostTrial(discovery.raw, discovery.world, true).supportedFindings).toBe(0)
    const args = fixture('discovery')
    args.raw.run.admission.materials = []
    tool(args, 'read', '2: CRITICAL-ALPHA: synthetic defect')
    args.raw.sessions[1]!.events.find(event => event.type === 'tool/call')!.data.arguments = '{}'
    expect(analyzeCostTrial(args.raw, args.world, true).supportedFindings).toBe(0)
    args.raw.sessions[1]!.events.find(event => event.type === 'tool/call')!.data.arguments = '{"file_path":"/public/archive-alpha.txt"}'
    expect(analyzeCostTrial(args.raw, args.world, true).supportedFindings).toBe(1)
  })

  it('rejects reverse timestamps and reports which immutable runtime inputs were mixed', () => {
    const f = fixture()
    f.raw.endedAt = '2026-11-11T03:00:00.000Z'
    expect(() => analyzeCostTrial(f.raw, f.world, true)).toThrow('timestamps')
    f.raw.endedAt = '2026-11-11T04:01:00.000Z'
    const first = analyzeCostTrial(f.raw, f.world, true)
    expect(() => aggregateCostTrials([first, { ...first, repetition: 2, treeHead: 'different' }])).toThrow('Mixed runtime')
    expect(() => aggregateCostTrials([first, { ...first, repetition: 2, worldManifestHash: 'different' }])).toThrow('Mixed runtime')
    const changedModel = structuredClone(first)
    changedModel.repetition = 2
    changedModel.calls[0]!.reasoningEffort = 'high'
    expect(() => aggregateCostTrials([first, changedModel])).toThrow('Mixed model configuration')
  })

  it('compares only complete three-trial arms and keeps zero-completion prices undefined', () => {
    const f = fixture()
    const first = analyzeCostTrial(f.raw, f.world, true)
    const trials = [1, 2, 3].flatMap(repetition => [
      { ...first, repetition, variant: 'baseline' as const }, { ...first, repetition, variant: 'candidate' as const },
    ])
    expect(aggregateCostTrials(trials).comparison[0]).toMatchObject({ completePairs: true, costPerQualifiedReportChangePercent: 0 })
    expect(aggregateCostTrials(trials.map(trial => ({ ...trial, validCompletion: false }))).comparison[0])
      .toMatchObject({ completePairs: true, costPerQualifiedReportChangePercent: null })
    expect(aggregateCostTrials(trials.map(trial => ({ ...trial, offPeakEquivalentUSD: 0, knownOffPeakEquivalentUSD: 0 }))).comparison[0])
      .toMatchObject({ completePairs: true, costPerQualifiedReportChangePercent: null })
    const unpriced = trials.map(trial => trial.variant === 'candidate'
      ? { ...trial, offPeakEquivalentUSD: null, knownOffPeakEquivalentUSD: 0, unpricedCalls: 1 } : trial)
    expect(aggregateCostTrials(unpriced).comparison[0]).toMatchObject({ costPerQualifiedReportChangePercent: null })
    expect(aggregateCostTrials(trials.filter(trial => trial.variant === 'baseline')).comparison[0]!.completePairs).toBe(false)
  })
})
