/** Independent accounting and source-location checks for public Conductor cost trials. */
import { createHash } from 'node:crypto'
import { z } from 'zod'

const count = z.number().int().nonnegative()
const usageSchema = z.object({
  inputTokens: count, outputTokens: count, cacheReadTokens: count.optional(),
  cacheWriteTokens: count.optional(), reasoningTokens: count.optional(),
})
const blockSchema = z.object({
  type: z.string(), text: z.string().optional(), toolCallId: z.string().optional(), isError: z.boolean().optional(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
})
const messageSchema = z.object({ role: z.string(), content: z.array(blockSchema) })
const eventSchema = z.object({ type: z.string(), data: z.object({
  turn: count.optional(), step: count.optional(), childId: z.string().optional(), role: z.string().optional(),
  callId: z.string().optional(), name: z.string().optional(), arguments: z.string().optional(),
  message: messageSchema.optional(), usage: usageSchema.optional(),
}) })
const materialSchema = z.object({ id: z.string(), kind: z.string(), selector: z.string(), content: z.string(), sha256: z.string() })
const rawSchema = z.object({
  manifest: z.object({ caseId: z.enum(['capture', 'discovery']), variant: z.enum(['baseline', 'candidate']),
    repetition: count, expectedHead: z.string(), worldManifestHash: z.string(), prepareOnly: z.boolean() }),
  driverSha256: z.string(), startedAt: z.iso.datetime(), endedAt: z.iso.datetime(),
  stopped: z.object({ reason: z.string().nullable() }),
  requests: z.array(z.object({ sequence: count, sessionId: z.string(), turn: count.nullable(), step: count.nullable(),
    usage: usageSchema.nullable(), issuedAt: z.iso.datetime(), finishedAt: z.iso.datetime().nullable(),
    model: z.string(), provider: z.string(), reasoningEffort: z.string().nullable().optional(), systemChars: count, historyChars: count,
    toolResultChars: count, repeatedToolResultChars: count,
    request: z.object({ messages: z.array(messageSchema) }),
  })),
  sessions: z.array(z.object({ header: z.object({ id: z.string() }), events: z.array(eventSchema) })),
  run: z.object({ status: z.string(), reportDecision: z.object({ decision: z.string() }).nullable().optional(),
    admission: z.object({ materials: z.array(materialSchema) }),
    history: z.array(z.object({ decision: z.string() })),
    reportCandidates: z.array(z.object({ producerChildId: z.string(), candidate: z.object({
      content: z.string(), material_spans: z.array(z.object({ material_id: z.string(), start_line: count, end_line: count })),
    }) })),
  }).nullable().optional(),
})
const worldSchema = z.object({ caseId: z.enum(['capture', 'discovery']), worldManifestHash: z.string(),
  files: z.array(z.object({ path: z.string(), bytes: count, sha256: z.string() })),
  expected: z.array(z.object({ id: z.string(), path: z.string(), line: count.positive() })),
})
const capturePageSchema = z.object({ material_id: z.string(), selector: z.string(), sha256: z.string(),
  start_line: count.positive(), end_line: count.positive(), lines: z.array(z.string()),
})

interface ToolStatistics {
  calls: number
  errors: number
  resultChars: number[]
}

/** Provider-reported counts are disjoint; reasoning is already inside output. */
export type MeasurementUsage = z.infer<typeof usageSchema>

/** Observer artifact fields used by the independent source and usage audit. */
export type MeasurementArtifact = z.infer<typeof rawSchema>

/**
 * Reprice one call at the official Flash off-peak rates checked 2026-11-11.
 * @param value - Provider usage with uncached input, rather than total prompt tokens.
 * @returns Integer nanodollars, or null when cache usage is absent or separately priced writes are unknown.
 */
export function offPeakNanodollars(value: unknown): number | null {
  if (value === null) return null
  const usage = usageSchema.parse(value)
  if (usage.reasoningTokens !== undefined && usage.reasoningTokens > usage.outputTokens) {
    throw new Error('Reasoning exceeds inclusive output')
  }
  if (usage.cacheReadTokens === undefined || (usage.cacheWriteTokens !== undefined && usage.cacheWriteTokens !== 0)) return null
  const nanos = usage.inputTokens * 150 + usage.cacheReadTokens * 3 + usage.outputTokens * 600
  if (!Number.isSafeInteger(nanos)) throw new Error('Price exceeds safe integer accounting')
  return nanos
}

const hash = (text: string): string => createHash('sha256').update(text).digest('hex')
const textOf = (block: z.infer<typeof blockSchema>): string => block.type === 'text'
  ? block.text ?? '' : (block.content ?? []).filter(item => item.type === 'text').map(item => item.text ?? '').join('\n')
const normalizedPath = (value: string): string => value.replaceAll('\\', '/')
const messageKey = (session: string, turn: number | null | undefined, step: number | null | undefined): string => `${session}:${turn}:${step}`
const escaped = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Audit a completed or stopped public trial without accepting its own verdict as factual proof.
 * @param rawValue - Local observer artifact, including logged session events.
 * @param worldValue - Independently generated source manifest and known critical records.
 * @param sourcesUnchanged - Fresh hash verification of every synthetic source file.
 * @returns Content-free accounting, exact-location scores, tool sizes, and explicit acceptance failures.
 */
export function analyzeCostTrial(rawValue: unknown, worldValue: unknown, sourcesUnchanged: boolean) {
  const raw = rawSchema.parse(rawValue)
  const world = worldSchema.parse(worldValue)
  if (raw.manifest.prepareOnly) throw new Error('Preparation is not a model trial')
  if (raw.manifest.caseId !== world.caseId || raw.manifest.worldManifestHash !== world.worldManifestHash
    || hash(JSON.stringify({ files: world.files, expected: world.expected })) !== world.worldManifestHash) {
    throw new Error('Synthetic source manifest does not match the trial')
  }
  const parent = raw.sessions.find(session => session.header.id === 'public-cost-parent')
  if (parent === undefined) throw new Error('Missing parent session')
  const roles = new Map(parent.events.filter(event => event.type === 'conductor/child')
    .map(event => [event.data.childId, event.data.role]))
  const logged = new Map<string, MeasurementUsage | undefined>()
  const tools = new Map<string, ToolStatistics>()
  const toolResults: Array<{ role: string; tool: string; modelCall: number | null; chars: number; error: boolean }> = []
  const observations: Array<{ session: string; tool: string; args: string; text: string; callId: string }> = []
  for (const session of raw.sessions) {
    const calls = new Map<string, { id: string; name: string; args: string; stats: ToolStatistics }>()
    for (const event of session.events) {
      if (event.type === 'assistant/message') {
        const key = messageKey(session.header.id, event.data.turn, event.data.step)
        if (logged.has(key)) throw new Error('Duplicate logged assistant usage')
        logged.set(key, event.data.usage)
      }
      if (event.type === 'tool/call') {
        if (event.data.callId === undefined || event.data.name === undefined || event.data.arguments === undefined) throw new Error('Incomplete tool-call identity')
        if (calls.has(event.data.callId)) throw new Error('Duplicate tool-call identity')
        const stats = tools.get(event.data.name) ?? { calls: 0, errors: 0, resultChars: [] }
        tools.set(event.data.name, stats)
        calls.set(event.data.callId, { id: event.data.callId, name: event.data.name, args: event.data.arguments, stats })
        stats.calls++
      }
      if (event.type !== 'tool/result') continue
      for (const block of event.data.message?.content ?? []) {
        if (block.type !== 'tool-result') continue
        const call = calls.get(block.toolCallId ?? '')
        if (call === undefined) throw new Error('Tool result has no matching call')
        const text = textOf(block)
        const stats = call.stats
        stats.resultChars.push(Array.from(text).length)
        toolResults.push({ role: session.header.id === parent.header.id ? 'parent' : roles.get(session.header.id) ?? 'auxiliary/unknown',
          tool: call.name, modelCall: raw.requests.find(request => request.sessionId === session.header.id
            && request.turn === event.data.turn && request.step === event.data.step)?.sequence ?? null,
          chars: Array.from(text).length, error: block.isError === true })
        if (block.isError) stats.errors++
        else observations.push({ session: session.header.id, tool: call.name, args: call.args, text, callId: call.id })
      }
    }
  }
  const failures: string[] = []
  let ledgerMatches = true
  let knownNanos = 0
  let unpricedCalls = 0
  let uncachedInput = 0, cacheRead = 0, output = 0, reasoning = 0
  let reasoningMissingCalls = 0, cacheWriteUnreportedCalls = 0
  const used = new Set<string>()
  const calls = raw.requests.map((request, index) => {
    if (request.sequence !== index + 1) throw new Error('Model-call sequence is not contiguous')
    const key = messageKey(request.sessionId, request.turn, request.step)
    if (used.has(key)) throw new Error('Duplicate model-call identity')
    used.add(key)
    if (!logged.has(key) || JSON.stringify(logged.get(key)) !== JSON.stringify(request.usage)) ledgerMatches = false
    const nanos = request.model === 'deepseek-flash' && request.provider === 'deepseek-official'
      ? offPeakNanodollars(request.usage) : null
    if (nanos === null) unpricedCalls++
    else knownNanos += nanos
    if (request.usage !== null) {
      uncachedInput += request.usage.inputTokens
      cacheRead += request.usage.cacheReadTokens ?? 0
      output += request.usage.outputTokens
      reasoning += request.usage.reasoningTokens ?? 0
    }
    if (request.usage?.reasoningTokens === undefined) reasoningMissingCalls++
    if (request.usage?.cacheWriteTokens === undefined) cacheWriteUnreportedCalls++
    return { sequence: request.sequence, role: request.sessionId === parent.header.id ? 'parent' : roles.get(request.sessionId) ?? 'auxiliary/unknown',
      issuedAt: request.issuedAt, finishedAt: request.finishedAt, model: request.model, provider: request.provider,
      reasoningEffort: request.reasoningEffort ?? null,
      usage: request.usage, offPeakEquivalentUSD: nanos === null ? null : nanos / 1e9,
      systemChars: request.systemChars, historyChars: request.historyChars,
      toolResultChars: request.toolResultChars, repeatedToolResultChars: request.repeatedToolResultChars }
  })
  if (logged.size !== raw.requests.length) ledgerMatches = false
  if (!ledgerMatches) failures.push('stream/log usage does not reconcile one-to-one')
  if (!sourcesUnchanged) failures.push('source hashes changed')
  if (unpricedCalls !== 0) failures.push('unknown or unpriced usage')
  if (raw.stopped.reason !== null) failures.push('external measurement stop')
  if (raw.run?.status !== 'reported' || raw.run.reportDecision?.decision !== 'accept') failures.push('no accepted report')
  const final = raw.run?.reportCandidates.at(-1)
  const visibleSourceResults = new Set(raw.requests.filter(request => request.sessionId === final?.producerChildId)
    .flatMap(request => request.request.messages.flatMap(message => message.content
      .filter(block => block.type === 'tool-result' && block.isError !== true)
      .map(block => JSON.stringify([block.toolCallId, textOf(block)])))))
  const producerInput = raw.requests.find(request => request.sessionId === final?.producerChildId)?.request.messages
    .flatMap(message => message.content.filter(block => block.type === 'text').map(textOf)) ?? []
  const finalContent = final?.candidate.content ?? ''
  const knownIds = new Set(world.expected.map(expected => expected.id))
  const unexpectedIds = [...new Set(finalContent.match(/\b(?:CRITICAL-[A-Z]+|RISK-\d{3})\b/g) ?? [])].filter(id => !knownIds.has(id))
  const scores = world.expected.map((expected) => {
    // A single report row must bind the ID, source path, and line; unrecognized layouts require manual review.
    const located = finalContent.split('\n').some(line => line.includes(expected.id) && normalizedPath(line).includes(expected.path)
      && new RegExp(`(^|[^0-9])${expected.line}([^0-9]|$)`).test(line))
    const material = raw.run?.admission.materials.find(item => item.kind === 'file' && item.selector === expected.path)
    const captured = material !== undefined && material.sha256 === hash(material.content)
      && world.files.some(file => file.path === expected.path && file.sha256 === material.sha256)
      && material.content.split(/\r?\n/)[expected.line - 1]?.includes(expected.id) === true
    const cited = captured && final?.candidate.material_spans.some(span => span.material_id === material.id
      && span.start_line >= 1 && span.start_line <= expected.line && span.end_line >= expected.line
      && span.end_line <= material.content.split(/\r?\n/).filter((line, index, lines) => index !== lines.length - 1 || line !== '').length) === true
    const inline = captured && producerInput.some(text => text.includes(JSON.stringify(material.content)))
    const exposed = observations.some((observation) => {
      if (observation.session !== final?.producerChildId) return false
      if (!visibleSourceResults.has(JSON.stringify([observation.callId, observation.text]))) return false
      if (world.caseId === 'capture') {
        if (observation.tool !== 'conductor_read_capture' || !captured) return false
        const page = capturePageSchema.safeParse(parseJson(observation.text))
        return page.success && page.data.material_id === material.id && page.data.sha256 === material.sha256
          && page.data.selector === expected.path && page.data.end_line === page.data.start_line + page.data.lines.length - 1
          && page.data.lines[expected.line - page.data.start_line] === material.content.split(/\r?\n/)[expected.line - 1]
      }
      if (!['grep', 'read'].includes(observation.tool) || !observation.text.includes(expected.id)) return false
      if (observation.tool === 'read') {
        const read = z.object({ file_path: z.string() }).safeParse(parseJson(observation.args))
        const path = read.success ? normalizedPath(read.data.file_path) : ''
        return (path === expected.path || path.endsWith('/' + expected.path))
          && new RegExp(`(?:[\\n\\r]|^)${expected.line}:\\s*[^\\n]*${escaped(expected.id)}`).test(observation.text)
      }
      // Source-capped pages bind each match on one line; inherited grep groups lines under a path heading.
      const lines = normalizedPath(observation.text).split('\n')
      let path = ''
      return lines.some((line) => {
        if (line.trim() === expected.path) path = expected.path
        else if (line.trim() !== '' && !line.startsWith('Line ') && !line.startsWith('Found ')) path = ''
        return new RegExp(`^${escaped(expected.path)}:${expected.line}:\\s*.*${escaped(expected.id)}`).test(line)
          || path === expected.path && new RegExp(`^Line ${expected.line}:\\s*.*${escaped(expected.id)}`).test(line)
      })
    })
    return { located, sourceExposed: inline || exposed, savedSpanValid: world.caseId === 'capture' ? cited : null }
  })
  if (scores.some(score => !score.located)) failures.push('missing or ambiguously located expected finding')
  if (scores.some(score => !score.sourceExposed)) failures.push('producer lacks observed source support')
  if (scores.some(score => score.savedSpanValid === false)) failures.push('missing valid saved-source span')
  if (unexpectedIds.length !== 0) failures.push('unexpected critical record identifier')
  const detectiveResultsAbove4000 = toolResults.filter(result => result.role === 'detective'
    && ['glob', 'grep', 'conductor_read_capture'].includes(result.tool) && result.chars > 4000).length
  if (raw.manifest.variant === 'candidate' && detectiveResultsAbove4000 !== 0) failures.push('Detective result exceeds the default 4000-character limit')
  const durationMs = Date.parse(raw.endedAt) - Date.parse(raw.startedAt)
  if (durationMs < 0) throw new Error('Invalid trial timestamps')
  return { caseId: world.caseId, variant: raw.manifest.variant, repetition: raw.manifest.repetition,
    treeHead: raw.manifest.expectedHead, driverSha256: raw.driverSha256, worldManifestHash: world.worldManifestHash,
    startedAt: raw.startedAt, endedAt: raw.endedAt, durationMs, status: raw.run?.status ?? 'not-started',
    stopped: raw.stopped.reason, accepted: raw.run?.reportDecision?.decision === 'accept',
    validCompletion: failures.length === 0, failures, expectedFindings: scores.length,
    locatedFindings: scores.filter(score => score.located).length, supportedFindings: scores.filter(score => score.sourceExposed).length,
    validSavedSpans: world.caseId === 'capture' ? scores.filter(score => score.savedSpanValid).length : null,
    unexpectedIdentifierCount: unexpectedIds.length, sourceFilesUnchanged: sourcesUnchanged, ledgerMatches,
    modelCalls: raw.requests.length, unpricedCalls, knownOffPeakEquivalentUSD: knownNanos / 1e9,
    offPeakEquivalentUSD: unpricedCalls === 0 ? knownNanos / 1e9 : null,
    tokens: { uncachedInput, cacheRead, output, reportedReasoning: reasoning, reasoningMissingCalls, cacheWriteUnreportedCalls },
    rework: raw.run?.history.filter(entry => entry.decision === 'rework').length ?? 0,
    detectiveResultsAbove4000, tools: Object.fromEntries(tools), toolResults, calls }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown } catch { return undefined }
}

/**
 * Include failed attempts in cost per oracle-qualified completion; never substitute zero for unknown usage.
 * @param trials - Independently audited trial summaries from one frozen measurement driver.
 * @returns Per-case/variant totals and price changes, with missing usage propagated as null.
 */
export function aggregateCostTrials(trials: Array<ReturnType<typeof analyzeCostTrial>>) {
  if (new Set(trials.map(trial => trial.driverSha256)).size > 1) throw new Error('Mixed measurement driver revisions')
  const modelSettings = new Set(trials.flatMap(trial => trial.calls.map(call =>
    JSON.stringify([call.provider, call.model, call.reasoningEffort]))))
  if (modelSettings.size > 1) throw new Error('Mixed model configuration')
  const identities = new Set<string>()
  const groups = new Map<string, [ReturnType<typeof analyzeCostTrial>, ...Array<ReturnType<typeof analyzeCostTrial>>]>()
  for (const trial of trials) {
    const key = `${trial.caseId}:${trial.variant}`
    const id = `${key}:${trial.repetition}`
    if (identities.has(id)) throw new Error('Duplicate trial identity')
    identities.add(id)
    const group = groups.get(key)
    if (group === undefined) {
      groups.set(key, [trial])
      continue
    }
    if (group.some(other => other.treeHead !== trial.treeHead || other.worldManifestHash !== trial.worldManifestHash)) {
      throw new Error('Mixed runtime heads or synthetic worlds')
    }
    group.push(trial)
    groups.set(key, group)
  }
  const summary = [...groups.values()].map((group) => {
    const first = group[0]
    const valid = group.filter(trial => trial.validCompletion)
    const knownCostUSD = group.reduce((sum, trial) => sum + trial.knownOffPeakEquivalentUSD, 0)
    const allPriced = group.every(trial => trial.offPeakEquivalentUSD !== null)
    const prices = group.flatMap(trial => trial.offPeakEquivalentUSD === null ? [] : [trial.offPeakEquivalentUSD]).sort((a, b) => a - b)
    const costUSD = allPriced ? knownCostUSD : null
    return { caseId: first.caseId, variant: first.variant, treeHead: first.treeHead,
      worldManifestHash: first.worldManifestHash, trials: group.length, oracleQualifiedCompletions: valid.length,
      unpricedCalls: group.reduce((sum, trial) => sum + trial.unpricedCalls, 0),
      modelCalls: group.reduce((sum, trial) => sum + trial.modelCalls, 0),
      rework: group.reduce((sum, trial) => sum + trial.rework, 0),
      knownOffPeakEquivalentUSD: knownCostUSD, totalOffPeakEquivalentUSD: costUSD,
      totalCostPerQualifiedReportUSD: costUSD !== null && valid.length > 0 ? costUSD / valid.length : null,
      meanAttemptPriceUSD: costUSD !== null ? costUSD / group.length : null,
      minAttemptPriceUSD: allPriced ? prices[0] : null,
      maxAttemptPriceUSD: allPriced ? prices.at(-1) : null,
      tokens: group.reduce((sum, trial) => ({
        uncachedInput: sum.uncachedInput + trial.tokens.uncachedInput,
        cacheRead: sum.cacheRead + trial.tokens.cacheRead,
        output: sum.output + trial.tokens.output,
        reportedReasoning: sum.reportedReasoning + trial.tokens.reportedReasoning,
      }), { uncachedInput: 0, cacheRead: 0, output: 0, reportedReasoning: 0 }) }
  })
  const comparison = [...new Set(summary.map(group => group.caseId))].map((caseId) => {
    const baseline = summary.find(group => group.caseId === caseId && group.variant === 'baseline')
    const candidate = summary.find(group => group.caseId === caseId && group.variant === 'candidate')
    const denominator = baseline?.totalCostPerQualifiedReportUSD
    const numerator = candidate?.totalCostPerQualifiedReportUSD
    const completePairs = baseline?.trials === 3 && candidate?.trials === 3
    return { caseId, completePairs,
      costPerQualifiedReportChangePercent: completePairs && denominator != null && denominator > 0 && numerator != null
        ? (numerator / denominator - 1) * 100 : null }
  })
  return { groups: summary, comparison }
}
