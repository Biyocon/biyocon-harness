/** Scripted host answers for P1 only; this provider is absent from product presets. */
import type { Context } from '@deepseek-ai/cordis'
import { ownerMandateHash } from '@deepseek-ai/dsh-conductor'
import type { ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import type {} from '../../../../packages/conductor/tool-conductor/src/owner-interaction.ts'

export const name = 'conductor-owner-script'

/** Supply deterministic host-owned answers without a UI or a production controller. */
export function apply(ctx: Context): void {
  ctx.provide('conductorOwnerTestProvider', {
    kind: 'scripted-test-provider',
    answer: async (run, question): Promise<ScriptedOwnerResponse | null> => {
      const scenario = process.env['DSH_CONDUCTOR_OWNER_SCENARIO']
      if (scenario === 'analysis-unavailable') return null
      const reject = scenario === 'rejected'
      return {
        source: 'scripted-test-provider', rootSessionId: question.rootSessionId,
        questionId: question.id, expectedRevision: run.ownerRevision,
        action: reject ? 'reject' : question.proposal === undefined ? 'answer_continue' : 'approve',
        answers: reject ? [] : question.items.map((item, index) => ({ itemId: item.id,
          text: scenario?.startsWith('analysis') ? 'Documented scope'
            : index === 0 ? 'provider-canonical' : index === 1 ? 'No localhost bypass' : 'Use the exact previewed reporting path.' })),
        ...!reject && question.proposal !== undefined ? { proposalHash: ownerMandateHash(question.proposal) } : {},
      }
    },
  })
}
