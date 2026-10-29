/**
 * Loader fixture that holds a background child until its parent's spawn turn ends.
 * @module subagent-report-fence
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-loop'

/** Fixture plugin name. */
export const name = 'subagent-report-fence'

/**
 * Hold a background child's execution until its parent's spawn turn ends so
 * settlement starts a separate parent turn in live and replay scenarios.
 * @param ctx - assembled ACP-agent context.
 */
export function apply(ctx: Context): void {
  const childReady = Promise.withResolvers<undefined>()
  const parentStopped = Promise.withResolvers<undefined>()
  let hasStopped = false

  ctx.effect(() => {
    const disposeSession = ctx.root.on('session/event', (session, event) => {
      if (session.header.parentSession !== undefined || event.type !== 'turn/end' || event.data.turn !== 1) return
      hasStopped = true
      parentStopped.resolve(undefined)
    })
    const disposeStep = ctx.root.on('agent/pre-step', async ({ agent, turn, step }, next) => {
      if (agent.session.header.parentSession !== undefined) {
        childReady.resolve(undefined)
        if (!hasStopped) await parentStopped.promise
      } else if (turn === 1 && step === 2) {
        await childReady.promise
      }
      return next()
    })
    return () => {
      disposeStep()
      disposeSession()
    }
  }, 'subagent-report-fence.listeners')
}
