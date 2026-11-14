/** Required-event admission for the raw Conductor replay composition. */
import type { Context } from '@deepseek-ai/cordis'
import { CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import type {} from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Required Conductor event names are admitted for this synthetic composition. */
    conductorSnapshotAdmission: true
  }
}

export const inject = ['sessions']

/**
 * Admit the fixture's vocabulary before its Conductor producer can mount.
 * @param ctx - test composition owning this registration.
 */
export function apply(ctx: Context): void {
  ctx.sessions.registerEventTypes(CONDUCTOR_SESSION_EVENT_TYPES)
  ctx.provide('conductorSnapshotAdmission', true)
}
