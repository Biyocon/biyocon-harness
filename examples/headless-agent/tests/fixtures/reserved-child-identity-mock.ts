/** Keyless model boundary for the assembled reserved-child identity snapshot. */

import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, ReasoningEffortId, type GenerateOptions, type LlmResolvedModelInfo, type StreamChunk } from '@deepseek-ai/dsh-llm'

const OFF = ReasoningEffortId('off')

class ReservedIdentityAdapter extends LlmAdapter {
  override async resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return {
      provider, id: model, name: model,
      reasoning: { efforts: [{ id: OFF, name: 'Off' }], defaultEffort: OFF },
    }
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const prompt = options.messages.flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text).join('\n')
    if (!prompt.includes(`actual-child-id:${options.sessionId}`)) {
      throw new Error('reserved child id is absent from the model-visible prompt')
    }
    const answer = 'IDENTIFIED'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: answer }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: answer } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Register the adapter used only by this keyless snapshot. */
export function installReservedIdentityAdapter(ctx: Context): void {
  ctx.llm.registerAdapter(['reserved-identity-mock'], new ReservedIdentityAdapter())
}
