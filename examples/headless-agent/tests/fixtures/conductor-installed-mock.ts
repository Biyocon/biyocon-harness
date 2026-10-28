import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CapturedReport, ConductorAdmission, GateRecord } from '@deepseek-ai/dsh-conductor'

function* call(name: string, value: unknown): Generator<StreamChunk> {
  const id = CallId(`installed-${name}`)
  const args = JSON.stringify(value)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

/** Stop after a real Detective read, before any write-capable stage. */
class InstalledConductorAdapter extends LlmAdapter {
  private gateCAttempts = 0
  private reportVersions = 0

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
      const source = options.messages.flatMap(message => message.content)
        .find(block => block.type === 'text' && (block.text.includes('Dispatch package:\n') || block.text.includes('Analysis record:\n')))
      if (source?.type !== 'text') throw new Error('No typed Conductor dispatch in fixture')
      const arbiter = source.text.includes('Analysis record:\n')
      const json = source.text.split(arbiter ? 'Analysis record:\n' : 'Dispatch package:\n')[1]!.split('\n\nReturn the structured result')[0]!
      const input = JSON.parse(json) as {
        run_id: string
        stage: string
        admission: ConductorAdmission
        current_report: CapturedReport | null
        report: CapturedReport
        audit_hash: string
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
      if (arbiter) {
        yield* call('structured_output', {
          run_id: input.run_id, purpose: 'analysis', candidate_hash: input.report.hash, audit_hash: input.audit_hash,
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
      const producer = input.admission.entry === 'detective' && input.admission.deliverable === 'recommendations'
        ? 'strategist' : input.admission.entry
      const rework = scenario === 'rework' && input.stage === 'devils-advocate' && this.gateCAttempts++ === 0
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
        status: blocked ? 'blocked' : rework ? 'rework' : 'ready',
        summary: blocked ? 'The analysis write was refused; no implementation or approval occurred.'
          : rework ? 'The supplied plan needs a planning repair.' : `${input.stage} assessed the captured owner material.`,
        material_ids: ids, blockers: blocked ? ['Read-only analysis cannot implement recommendations.'] : [],
        assumptions: [], limitations: ['Static analysis only; no commands were run.'],
        ...rework ? { defect: 'plan' } : {},
        ...input.stage === 'auditor' ? { candidate_hash: input.current_report!.hash } : {},
        ...input.stage === producer && !rework && !blocked ? { candidate: {
          version: `report-${++this.reportVersions}`, deliverable: input.admission.deliverable,
          content: input.admission.deliverable === 'recommendations'
            ? '1. Document ownership first because it removes ambiguity. 2. Add examples next because they make the plan reviewable.'
            : 'The supplied plan has a clear scope but needs explicit ownership. This is a report, not implementation approval.',
          criteria: criteria.map(criterion => ({ criterion, outcome: 'Assessed from the captured input.' })),
          material_ids: ids, assumptions: [], limitations: ['No implementation or test verification was performed.'],
        } } : {},
      })
      return
    }
    if (result === undefined) {
      const later = ['plan', 'rework', 'source-repair'].includes(scenario)
      yield* call('conductor', {
        purpose: scenario === 'source-repair' ? 'implementation' : 'analysis',
        entry: scenario === 'forbidden' ? 'auditor' : later ? 'devils-advocate' : 'detective',
        ...scenario === 'source-repair' ? {} : { deliverable: ['recommendations', 'authority', 'criteria-rework'].includes(scenario) ? 'recommendations' : 'answer' },
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
    } else if (result.isError && scenario !== 'forbidden' && scenario !== 'missing-criteria') throw new Error(`Unexpected intake failure: ${JSON.stringify(result)}`)
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
}
