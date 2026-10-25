import type { Context } from '@deepseek-ai/cordis'
import { CallId, LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'

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

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
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
        objective: 'Check Gate C report repair and preserve the owner paths. Do not change files.',
        sourceBaseline: 'HEAD', authority: { owner: 'snapshot-user' },
        scope: ['probe.txt'], allowedPaths: ['owner-allowed'], excludedPaths: ['owner-allowed/protected'],
        acceptanceCriteria: ['Report repair preserves the owner paths and truthful gate history.'],
      })
      return
    }
    yield* text('Conductor returned its recorded gate history and final status.')
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
