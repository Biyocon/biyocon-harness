/** Deterministic model responses for the installed preset's P1 owner ledger. */
import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { CapturedReport, ConductorAdmission, OwnerInteraction } from '@deepseek-ai/dsh-conductor'

interface Dispatch {
  run_id: string
  stage: string
  admission: ConductorAdmission
  acceptance_criteria: string[]
  current_report: CapturedReport | null
  report: CapturedReport
  audit_hash: string
  owner_ledger: OwnerInteraction[]
}

function* call(name: string, value: unknown): Generator<StreamChunk> {
  const id = CallId(`owner-${name}`)
  const args = JSON.stringify(value)
  yield { type: 'block-start', index: 0, blockType: 'tool-call' }
  yield { type: 'tool-call-delta', index: 0, id, name, argumentsDelta: args }
  yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: args } }
  yield { type: 'finish', reason: { kind: 'tool-calls' } }
}

function* text(value: string): Generator<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text: value }
  yield { type: 'block-end', index: 0, block: { type: 'text', text: value } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

class OwnerConductorAdapter extends LlmAdapter {
  private producerAttempts = 0

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const scenario = process.env['DSH_CONDUCTOR_OWNER_SCENARIO']
    if (scenario === undefined) throw new Error('Owner snapshot requires an explicit scenario')
    const result = options.messages.at(-1)?.content.find(block => block.type === 'tool-result')
    const child = options.tools?.some(tool => tool.name === 'structured_output') === true
    if (result?.isError) throw new Error(`Owner snapshot tool failed: ${JSON.stringify(result.content)}`)
    if (!child) {
      if (result !== undefined) {
        yield* text('Conductor retained its exact gate and owner ledger; no implementation was performed.')
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
      const analysis = scenario.startsWith('analysis')
      yield* call('conductor', {
        purpose: analysis ? 'analysis' : 'implementation', entry: analysis ? 'detective' : 'strategist',
        ...analysis ? { deliverable: 'answer' } : { sourceBaseline: 'HEAD', allowedPaths: ['owner-allowed'] },
        rationale: 'Exercise explicit owner clarification through the installed preset.',
        objective: 'Review probe.txt and ask the owner for the missing choices. Do not modify files.',
        scope: ['probe.txt'], scopeSources: ['current-request'], materialFiles: ['probe.txt'],
        authority: { owner: 'snapshot-user' },
        acceptanceCriteria: ['Use the explicit owner answers and keep the workspace unchanged.'],
      })
      return
    }
    if (result !== undefined) {
      yield* text('The specialist returned its structured report to Conductor.')
      return
    }
    const source = options.messages.flatMap(message => message.content).find(block => block.type === 'text'
      && (block.text.includes('Dispatch package:\n') || block.text.includes('Analysis record:\n')))
    if (source?.type !== 'text') throw new Error('Owner fixture requires the real typed dispatch package')
    const arbiter = source.text.includes('Analysis record:\n')
    const json = source.text.split(arbiter ? 'Analysis record:\n' : 'Dispatch package:\n')[1]!
      .split('\n\nReturn the structured result')[0]!
    const input = JSON.parse(json) as Dispatch
    if (arbiter) {
      yield* call('structured_output', {
        run_id: input.run_id, purpose: 'analysis', candidate_hash: input.report.hash, audit_hash: input.audit_hash,
        decision: 'accept', basis: ['The report incorporates the owner clarification.'],
        evidence_reviewed: [input.report.hash, input.audit_hash], open_risks: [],
      })
      return
    }
    if (input.admission.purpose === 'analysis') {
      const ids = input.admission.materials.map(material => material.id)
      const first = input.stage === 'detective' && this.producerAttempts++ === 0
      if (input.stage === 'detective' && !first && !JSON.stringify(input.owner_ledger).includes('Documented scope')) {
        throw new Error('Reassessment must receive the durable owner answer in its dispatch package')
      }
      yield* call('structured_output', {
        run_id: input.run_id, purpose: 'analysis', stage: input.stage, deliverable: 'answer',
        status: first ? 'blocked' : 'ready', summary: first ? 'The report needs an owner scope clarification.' : `${input.stage} assessed the owner answer.`,
        material_ids: ids, blockers: first ? ['The intended reporting scope is unknown.'] : [], assumptions: [], limitations: ['Read-only static review.'],
        ...first ? { clarifications: [{ id: 'scope', prompt: 'Which reporting scope should be used?', options: [] }] } : {},
        ...input.stage === 'auditor' ? { candidate_hash: input.current_report!.hash } : {},
        ...input.stage === 'detective' && !first ? { candidate: {
          version: 'answer-1', deliverable: 'answer', content: 'The owner selected Documented scope. No implementation is authorized.',
          criteria: input.acceptance_criteria.map(criterion => ({ criterion, outcome: 'Answered using the explicit owner clarification.' })),
          material_ids: ids, assumptions: [], limitations: ['No commands or writes.'],
        } } : {},
      })
      return
    }
    const first = this.producerAttempts++ === 0
    if (!first && !JSON.stringify(input.owner_ledger).includes('provider-canonical')) {
      throw new Error('Strategist reassessment must receive the durable owner answers')
    }
    yield* call('structured_output', {
      run_id: input.run_id, stage: input.stage, baseline_ref: 'HEAD', status: first ? 'blocked' : 'failed',
      summary: first ? 'Strategist needs two owner choices and a concrete reporting-path amendment.' : 'Strategist received the owner answers; this P1 fixture stops before execution.',
      evidence: [{ kind: 'file', reference: 'probe.txt', outcome: 'Read-only fixture input.' }], findings: [], assumptions: [],
      blockers: first ? ['Two plan choices and the reporting-path proposal need owner input.'] : ['The keyless P1 probe intentionally performs no implementation.'],
      artifacts: [], quality_evidence_ids: [],
      change_requests: first ? [
        { target: 'plan', reason: 'Which canonical provider ID should the plan use?', impact: 'Choose one provider ID.' },
        { target: 'plan', reason: 'Which localhost bypass policy should the plan use?', impact: 'Make the policy explicit.' },
        { target: 'authority', reason: 'May the report use owner-allowed/report.md?', impact: 'Preview the exact reporting-path amendment.',
          proposal: { allowedPaths: ['owner-allowed/report.md'], excludedPaths: [], qualityCommandIds: [] } },
      ] : [],
      recommended_transition: { target: 'conductor', rationale: 'Conductor owns the gate and any owner reassessment.' }, confidence: 'high',
    })
  }
}

export const name = 'conductor-owner-mock'
export const inject = ['llm']

/** Register only the deterministic model adapter; the installed preset stays real. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['conductor-installed'], new OwnerConductorAdapter())
}
