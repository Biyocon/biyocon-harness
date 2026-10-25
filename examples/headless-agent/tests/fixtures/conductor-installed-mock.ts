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
  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
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
}

export const name = 'conductor-installed-mock'
export const inject = ['llm']

/** Register the external model substitute. */
export function apply(ctx: Context): void {
  ctx.llm.registerAdapter(['conductor-installed'], new InstalledConductorAdapter())
}
