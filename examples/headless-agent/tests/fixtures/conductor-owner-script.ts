/** Scripted answers through the real user-questions seam; absent from shipped presets. */
import type { Context } from '@deepseek-ai/cordis'
import { ownerMandateHash, pendingOwnerQuestion, SessionConductorRunStore } from '@deepseek-ai/dsh-conductor'
import type { ScriptedOwnerResponse } from '@deepseek-ai/dsh-conductor'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '../../../../packages/conductor/tool-conductor/src/owner-controller.ts'

export const name = 'conductor-owner-script'
export const inject = ['userQuestions', 'sessions']

/** Drive the controller through the installed preset's real loop and durable session. */
export function apply(ctx: Context): void {
  const done = Promise.withResolvers<undefined>()
  ctx.userQuestions.registerProvider({ ask: async (request) => {
    const scenario = process.env['DSH_CONDUCTOR_OWNER_SCENARIO']
    return { answers: request.questions.map((question, index) => ({ id: question.id,
      selected: index === 0 ? [scenario === 'rejected' ? 'reject' : 'answer_continue'] : [],
      ...index === 0 || scenario === 'rejected' ? {} : { custom: scenario?.startsWith('analysis') ? 'Documented scope'
        : index === 1 ? 'provider-canonical' : index === 2 ? 'No localhost bypass' : 'Use the exact previewed reporting path.' },
    })) }
  } })
  ctx.provide('conductorOwnerHostTest', {
    kind: 'scripted-test-provider', settled: done.promise,
    interact: async (controller, agent, runId, signal) => {
      try {
        if (process.env['DSH_CONDUCTOR_OWNER_SCENARIO'] === 'analysis-unavailable') return
        const binding = await controller.reconnect(agent, runId)
        const store = new SessionConductorRunStore(agent.session, () => Promise.resolve())
        const run = (await store.load(runId))!
        const question = pendingOwnerQuestion(run)!
        const answer = await ctx.userQuestions.ask({ agent, signal, questions: [
          { id: `${binding.transportId}/action`, question: question.reason,
            detail: JSON.stringify({ binding, proposal: question.proposal }),
            options: [{ label: 'answer_continue' }, { label: 'reject' }] },
          ...question.items.map(item => ({ id: `${binding.transportId}/${item.id}`, question: item.prompt })),
        ] })
        const reject = answer.answers[0]!.selected[0] === 'reject'
        const response: ScriptedOwnerResponse = {
          source: 'scripted-test-provider', rootSessionId: agent.id, questionId: binding.questionId,
          expectedRevision: binding.revision, action: reject ? 'reject' : question.proposal === undefined ? 'answer_continue' : 'approve',
          answers: reject ? [] : question.items.map((item, index) => ({ itemId: item.id, text: answer.answers[index + 1]!.custom! })),
          ...!reject && question.proposal !== undefined ? { proposalHash: ownerMandateHash(question.proposal) } : {},
        }
        await controller.respond(agent, binding, response, signal)
        await agent.whenIdle()
        if (!await ctx.sessions.flush(agent.session)) throw new Error('Owner fixture final flush failed')
      } catch (error: unknown) {
        done.reject(error)
        throw error
      } finally { done.resolve(undefined) }
    },
  })
}
