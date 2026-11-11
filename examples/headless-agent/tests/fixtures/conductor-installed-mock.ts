import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CapturedReport, ConductorAdmission, GateRecord, IntakeMaterial } from '@deepseek-ai/dsh-conductor'
import { installDetectiveSearchWorldChanges, nextDetectiveSearchPage } from './detective-search-world.ts'
import { installDetectiveCaptureWorldChanges, nextDetectiveCaptureRead } from './detective-capture-world.ts'
import type { IndexedFixtureMaterial } from './detective-capture-world.ts'

function* call(name: string, value: unknown, outputTokens?: number): Generator<StreamChunk> {
  const id = CallId(`installed-${name}`)
  const args = JSON.stringify(value)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
  if (outputTokens !== undefined) yield { type: 'usage', usage: { inputTokens: 10, outputTokens } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** Stop after a real Detective read, before any write-capable stage. */
export class InstalledConductorAdapter extends LlmAdapter {
  private gateCAttempts = 0
  private reportVersions = 0
  private auditorAttempts = 0

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, enforcesMaxTokensIncludingReasoning: true as const })
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const intake = process.env['DSH_CONDUCTOR_INTAKE_SCENARIO']
    if (intake !== undefined) {
      yield* this.intakeScenario(options, intake)
      return
    }
    const scenario = process.env['DSH_CONDUCTOR_GATE_SCENARIO']
    if (scenario !== undefined) {
      yield* this.gateScenario(options, scenario)
      return
    }
    const child = options.tools?.some(tool => tool.name === 'structured_output') === true
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (result?.isError === true) throw new Error(`Conductor fixture tool failed: ${JSON.stringify(result.content)}`)
    if (child) {
      if (result?.toolCallId === 'installed-structured_output') {
        const text = 'Detective reported the external marker and the intentional blocker.'
        yield { type: 'block-start', index: 0, blockType: 'text' }
        yield { type: 'text-delta', index: 0, text }
        yield { type: 'block-end', index: 0, block: { type: 'text', text } }
        yield { type: 'finish', reason: { kind: 'stop' } }
        return
      }
      if (result === undefined) {
        yield* call('read', { file_path: 'probe.txt' })
        return
      }
      const prompt = JSON.stringify(options.messages)
      const runId = /CON-\d{4}-\d{4}/.exec(prompt)?.[0]
      if (runId === undefined) throw new Error('Detective dispatch has no run id')
      yield* call('structured_output', {
        run_id: runId, stage: 'detective', baseline_ref: 'HEAD',
        status: 'blocked', summary: 'Detective read the external workspace.',
        evidence: [{ kind: 'file', reference: 'probe.txt', outcome: 'DETECTIVE_EXTERNAL_OK' }],
        findings: [], assumptions: [], blockers: ['Read-only snapshot stops after Detective.'],
        artifacts: [], change_requests: [], quality_evidence_ids: [],
        recommended_transition: { target: 'conductor', rationale: 'Report the intentional snapshot blocker.' },
        confidence: 'high',
      })
      return
    }
    if (result === undefined) {
      // Prefer the project's requested solo read whenever the runtime exposes it.
      if (options.tools?.some(tool => tool.name === 'read') === true) {
        yield* call('read', { file_path: 'probe.txt' })
        return
      }
      yield* call('conductor', {
        purpose: 'implementation', entry: 'detective', rationale: 'Exercise the installed Detective before execution.',
        objective: 'Analyze probe.txt and report the three most important improvements. Do not modify files.',
        sourceBaseline: 'HEAD', authority: { owner: 'snapshot-user' },
        scope: ['probe.txt'],
        acceptanceCriteria: ['Detective reads the external marker and reports a blocker.'],
      })
      return
    }
    const text = 'Conductor stopped after Detective: DETECTIVE_EXTERNAL_OK.'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }

  private * gateScenario(options: GenerateOptions, scenario: string): Generator<StreamChunk> {
    const child = options.tools?.find(tool => tool.name === 'structured_output')
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (child !== undefined) {
      if (result?.toolCallId === 'installed-structured_output') {
        // End an invalid capture without repairing it inside the same child, so Conductor owns rework.
        yield* text('Specialist finished its report attempt.')
        return
      }
      if (result?.isError === true) throw new Error(`Unexpected fixture tool error: ${JSON.stringify(result)}`)
      const properties = child.parameters['properties'] as Record<string, unknown>
      if (!('run_id' in properties)) {
        yield* call('structured_output', {
          status: 'complete', summary: 'Ralph checked the approved read-only task.',
          evidence: ['No file changes or quality commands are required.'], nextSteps: [], blocker: '',
        })
        return
      }
      const prompt = options.messages.flatMap(message => message.content)
        .filter(block => block.type === 'text').map(block => block.text).join('\n')
      const runId = /CON-\d{4}-\d{4}/.exec(prompt)?.[0]
      if (runId === undefined) throw new Error('Specialist request has no run id')
      if ('decision' in properties) {
        yield* call('structured_output', {
          run_id: runId, decision: 'go', basis: ['Owner paths remained unchanged.'],
          evidence_reviewed: ['Gate history and owner-approved baseline'], conditions: [], open_risks: [], required_follow_up: [],
        })
        return
      }
      const stage = /"stage"\s*:\s*"([a-z-]+)"/.exec(prompt)?.[1]
      if (stage === undefined) throw new Error('Specialist request has no stage')
      if (stage === 'detective' && result === undefined) {
        yield* call('read', { file_path: 'probe.txt' })
        return
      }
      const invalidPaths = stage === 'devils-advocate'
        && (scenario === 'blocked' || this.gateCAttempts++ === 0)
      yield* call('structured_output', {
        run_id: runId, stage, baseline_ref: 'HEAD', status: 'ready',
        summary: `${stage} evaluated the owner-scoped task.`,
        evidence: [{ kind: 'review', reference: 'probe.txt', outcome: 'Owner-scoped fixture inputs reviewed.' }],
        findings: [], assumptions: [], blockers: [], artifacts: [], change_requests: [], quality_evidence_ids: [],
        ...stage === 'devils-advocate' ? { execution_baseline: {
          scopeVersion: 'scope-1', planVersion: 'plan-1', acceptanceVersion: 'acceptance-1',
          rollbackReference: 'HEAD', qualityCommandIds: [],
          ...invalidPaths ? { allowedPaths: ['outside-owner-scope'], excludedPaths: [] } : {},
        } } : {},
        recommended_transition: { target: 'conductor', rationale: 'Conductor evaluates this report.' }, confidence: 'high',
      })
      return
    }
    if (result?.isError === true) throw new Error(`Conductor fixture failed: ${JSON.stringify(result)}`)
    if (result === undefined) {
      yield* call('conductor', {
        purpose: 'implementation', entry: 'detective', rationale: 'Verify owner path handling through the implementation route.',
        objective: 'Check Gate C report repair and preserve the owner paths. Do not change files.',
        sourceBaseline: 'HEAD', authority: { owner: 'snapshot-user' },
        scope: ['probe.txt'], allowedPaths: ['owner-allowed'], excludedPaths: ['owner-allowed/protected'],
        acceptanceCriteria: ['Report repair preserves the owner paths and truthful gate history.'],
      })
      return
    }
    yield* text('Conductor returned its recorded gate history and final status.')
  }

  private * intakeScenario(options: GenerateOptions, scenario: string): Generator<StreamChunk> {
    const child = options.tools?.some(tool => tool.name === 'structured_output') === true
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    if (child) {
      if (result?.toolCallId === 'installed-structured_output') {
        yield* text('The specialist returned its report to Conductor.')
        return
      }
      const criticPrompt = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'text' && block.text.startsWith('{"identity":'))
      if (criticPrompt?.type === 'text') {
        const prompt = JSON.parse(criticPrompt.text) as { identity: {
          run_id: string
          candidate_hash: string
          candidate_version: string
          material_ids: string[]
          critic_child_id: string
          critic_attempt: number
        } }
        const identity = prompt.identity
        const web = scenario === 'critic-web-holds' || scenario === 'critic-web-escalated' || scenario === 'critic-web-invalid'
        const literal = '<script>alert("finding")</script> [external](https://example.invalid)'
        const rework = scenario === 'critic-web-escalated' || (scenario === 'critic-rework' && identity.critic_attempt === 1)
          || (scenario === 'critic-owner-rework' && identity.critic_attempt <= 3)
        const malformed = scenario === 'critic-budget'
          || ((scenario === 'critic-malformed' || scenario === 'critic-web-invalid') && identity.critic_attempt === 1)
        yield* call('structured_output', {
          run_id: identity.run_id, purpose: 'analysis',
          candidate_hash: scenario === 'critic-stale' ? '0'.repeat(64) : identity.candidate_hash,
          candidate_version: identity.candidate_version,
          material_ids: identity.material_ids,
          critic_child_id: identity.critic_child_id,
          critic_attempt: identity.critic_attempt,
          findings: web ? [{ id: 'web-finding', severity: rework ? 'critical' : malformed ? 'major' : 'minor',
            claim: `Claim: ${literal}`, rationale: `Rationale: ${literal}`, material_ids: identity.material_ids }] : rework || malformed ? [{
            id: 'reasoning-risk', severity: 'major', claim: 'The priority does not follow from the cited material.',
            rationale: 'The report does not compare the available alternatives.', material_ids: identity.material_ids,
          }] : [],
          conclusion: rework ? 'does_not_hold' : 'holds',
          ...rework ? { defect: 'report' } : {},
          summary: web ? `Summary: ${literal}` : rework ? 'The recommendation needs a new candidate.' : 'The reasoning follows the admitted material.',
        }, 5)
        return
      }
      const source = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'text' && (block.text.includes('Dispatch package:\n') || block.text.includes('Analysis record:\n')))
      if (source?.type !== 'text') throw new Error('No typed Conductor dispatch in fixture')
      const arbiter = source.text.includes('Analysis record:\n')
      const json = source.text.split(arbiter ? 'Analysis record:\n' : 'Dispatch package:\n')[1]!.split('\n\nReturn the structured result')[0]!
      const input = JSON.parse(json) as {
        run_id: string
        stage: string
        admission: Omit<ConductorAdmission, 'materials'> & { materials: Array<IntakeMaterial | IndexedFixtureMaterial> }
        current_report: CapturedReport | null
        report: CapturedReport
        audit_hash: string
        analysis_challenges: Array<{ hash: string }>
        current_challenge_hash: string
        acceptance_criteria: string[]
        gate_history: GateRecord[]
        report_criteria_instruction: string
      }
      if (scenario === 'source-repair') {
        if (input.stage !== 'detective') throw new Error('Missing source baseline must dispatch Detective first')
        yield* call('structured_output', {
          run_id: input.run_id, stage: 'detective', baseline_ref: 'HEAD', status: 'blocked',
          summary: 'Detective must assess the actual source before implementation.',
          evidence: [], findings: [], assumptions: [], blockers: ['This snapshot stops before source assessment and approval.'],
          artifacts: [], change_requests: [], quality_evidence_ids: [],
          recommended_transition: { target: 'conductor', rationale: 'Report the missing assessed source state.' }, confidence: 'high',
        })
        return
      }
      if (input.admission.purpose !== 'analysis') throw new Error('Fixture expects an analysis dispatch')
      if (input.stage === 'detective') {
        const next = nextDetectiveCaptureRead(options, input.admission.materials)
        if (next !== undefined) {
          yield* call('conductor_read_capture', next)
          return
        }
      }
      if (scenario === 'detective-search-pages' && input.stage === 'detective') {
        const next = nextDetectiveSearchPage(result?.toolCallId === 'installed-conductor_read_capture' ? undefined : result)
        if (next !== undefined) {
          yield* call(next.name, next.args)
          return
        }
      }
      if (arbiter) {
        const challengeHash = input.analysis_challenges.at(-1)?.hash
        if (challengeHash === undefined || challengeHash !== input.current_challenge_hash) {
          throw new Error('Arbiter must receive the latest accepted analysis challenge')
        }
        yield* call('structured_output', {
          run_id: input.run_id, purpose: 'analysis', candidate_hash: input.report.hash, audit_hash: input.audit_hash,
          challenge_hash: challengeHash,
          decision: 'accept', basis: ['The independent audit reviewed the exact report and its sources.'],
          evidence_reviewed: [input.report.hash, input.audit_hash], open_risks: ['Static review is not command verification.'],
        })
        return
      }
      if (scenario === 'authority' && input.stage === 'strategist' && result === undefined) {
        // Deliberately attempt a hidden tool: the real executor must refuse it.
        yield* call('write', { file_path: 'plan.md', content: 'UNAUTHORIZED_REPLACEMENT' })
        return
      }
      if (scenario === 'authority' && input.stage === 'strategist' && result?.isError !== true) {
        throw new Error('An analysis write unexpectedly succeeded')
      }
      const ids = input.admission.materials.map(material => material.id)
      const materialSpans = input.admission.materials.map((material) => {
        if (!('content' in material)) return { material_id: material.id, start_line: 1, end_line: material.line_count }
        const lines = material.content.split(/\r\n|\n|\r/)
        return { material_id: material.id, start_line: 1,
          end_line: lines.length - (lines.at(-1) === '' ? 1 : 0) }
      })
      const producer = input.admission.entry === 'detective' && input.admission.deliverable === 'recommendations'
        ? 'strategist' : input.admission.entry
      const rework = scenario === 'rework' && input.stage === 'devils-advocate' && this.gateCAttempts++ === 0
      const auditRework = scenario === 'critic-auditor-rework' && input.stage === 'auditor' && this.auditorAttempts++ === 0
      const blocked = scenario === 'authority' && input.stage === 'strategist'
      let criteria = input.acceptance_criteria
      if (scenario === 'criteria-rework' && input.stage === 'strategist') {
        const repair = input.gate_history.findLast(gate => gate.kind === 'evaluated' && gate.gate === 'B' && gate.decision === 'rework')
        if (repair?.kind === 'evaluated') {
          const basis = repair.basis.join('\n')
          if (!basis.includes(`Expected acceptance_criteria: ${JSON.stringify(criteria)}`)
            || !basis.includes('Differences:') || !basis.includes('Unrequested criterion')
            || !input.report_criteria_instruction.includes('verbatim and in the same order')) {
            throw new Error('The first rework must deliver the exact criterion list and actionable differences to Strategist')
          }
        } else {
          criteria = ['Unrequested criterion']
        }
      }
      yield* call('structured_output', {
        run_id: input.run_id, purpose: 'analysis', stage: input.stage, deliverable: input.admission.deliverable,
        status: blocked ? 'blocked' : rework || auditRework ? 'rework' : 'ready',
        summary: blocked ? 'The analysis write was refused; no implementation or approval occurred.'
          : rework ? 'The supplied plan needs a planning repair.'
            : auditRework ? 'The report candidate needs a fresh analysis and critique.'
              : `${input.stage} assessed the captured owner material.`,
        material_ids: ids, blockers: blocked ? ['Read-only analysis cannot implement recommendations.'] : [],
        assumptions: [], limitations: ['Static analysis only; no commands were run.'],
        ...rework ? { defect: 'plan' } : {},
        ...auditRework ? { defect: 'analysis' } : {},
        ...input.stage === 'auditor' ? { candidate_hash: input.current_report!.hash } : {},
        ...input.stage === producer && !rework && !blocked ? { candidate: {
          version: `report-${++this.reportVersions}`, deliverable: input.admission.deliverable,
          content: scenario === 'detective-capture-pages'
            ? 'The captured plan has no rollback (LATE_ADVERSE_FINDING). This report uses the saved source, not the later workspace replacement.'
            : input.admission.deliverable === 'recommendations'
              ? '1. Document ownership first because it removes ambiguity. 2. Add examples next because they make the plan reviewable.'
              : 'The supplied plan has a clear scope but needs explicit ownership. This is a report, not implementation approval.',
          criteria: criteria.map(criterion => ({ criterion, outcome: 'Assessed from the captured input.' })),
          material_ids: ids, material_spans: materialSpans,
          assumptions: [], limitations: ['No implementation or test verification was performed.'],
        } } : {},
      })
      return
    }
    if (result === undefined) {
      const resumeRunId = process.env.DSH_CONDUCTOR_RESUME_RUN_ID
      if (resumeRunId !== undefined) {
        yield* call('conductor', {
          runId: resumeRunId, purpose: 'analysis', entry: 'detective', deliverable: 'answer',
          objective: 'Analyze the supplied plan.md and report the findings without modifying files.',
          authority: { owner: 'snapshot-user' },
        })
        return
      }
      const continuation = options.messages.flatMap(message => message.content).findLast(block => block.type === 'text'
        && block.text.startsWith('Continue only the stored Conductor run.'))
      if (continuation?.type === 'text') {
        const stored = JSON.parse(continuation.text.slice(continuation.text.indexOf('\n') + 1)) as {
          runId: string
          objective: string
          admission: ConductorAdmission
          authority: { owner: string }
          allowedPaths: string[]
          excludedPaths: string[]
        }
        yield* call('conductor', { runId: stored.runId, objective: stored.objective,
          purpose: stored.admission.purpose, entry: stored.admission.entry,
          ...stored.admission.purpose === 'analysis' ? { deliverable: stored.admission.deliverable } : {},
          authority: stored.authority, allowedPaths: stored.allowedPaths, excludedPaths: stored.excludedPaths })
        return
      }
      const later = ['plan', 'rework', 'source-repair', 'critic-entry-c', 'critic-entry-c-answer'].includes(scenario)
      const strategistEntry = scenario === 'critic-entry-b-answer' || scenario === 'critic-entry-b-recommendations'
      yield* call('conductor', {
        purpose: scenario === 'source-repair' ? 'implementation' : 'analysis',
        entry: scenario === 'forbidden' ? 'auditor' : later ? 'devils-advocate' : strategistEntry ? 'strategist' : 'detective',
        ...scenario === 'source-repair' ? {} : { deliverable: ['recommendations', 'authority', 'criteria-rework', 'critic-entry-c', 'critic-entry-b-recommendations'].includes(scenario) ? 'recommendations' : 'answer' },
        rationale: later ? 'The owner supplied a plan for review.' : 'Answer or recommend improvements from the current request.',
        objective: 'Analyze the supplied plan.md and report the findings without modifying files.',
        scope: ['plan.md'], scopeSources: ['current-request'], materialFiles: ['plan.md'],
        ...later ? { plan: ['Review the supplied plan.'], planSources: ['plan.md'] } : {},
        authority: { owner: 'snapshot-user' },
        acceptanceCriteria: scenario === 'missing-criteria' ? [] : ['Answer the owner task using the supplied evidence.'],
        ...scenario === 'missing-criteria' ? { constraints: ['Answer the owner task using the supplied evidence.'] } : {},
      })
      return
    }
    if (scenario === 'answer') {
      if (result.toolCallId === 'installed-conductor' && !result.isError) { yield* call('read', { file_path: 'plan.md' }); return }
      if (result.toolCallId === 'installed-read' && result.isError) { yield* call('write', { file_path: 'plan.md', content: 'NO' }); return }
      if (result.toolCallId === 'installed-write' && result.isError) { yield* call('conductor', {}); return }
      if (!result.isError) throw new Error('Parent analysis fallback unexpectedly succeeded')
    } else if (result.isError && !['forbidden', 'missing-criteria', 'critic-image', 'critic-resume-pause'].includes(scenario)) {
      throw new Error(`Unexpected intake failure: ${JSON.stringify(result)}`)
    }
    yield* text('Conductor returned its recorded report or explicit rejection; no implementation was performed.')
  }
}

function* text(value: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: value }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

export const name = 'conductor-installed-mock'
export const inject = ['llm']

/** Register the external model substitute. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['conductor-installed'], new InstalledConductorAdapter())
  if (process.env.DSH_CONDUCTOR_INTAKE_SCENARIO === 'detective-search-pages') installDetectiveSearchWorldChanges(ctx)
  if (process.env.DSH_CONDUCTOR_INTAKE_SCENARIO === 'detective-capture-pages') installDetectiveCaptureWorldChanges(ctx)
}
