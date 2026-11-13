/** rc.7 session provider that admits Conductor history before publishing sessions. */
import type { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-projection'
import { CONDUCTOR_SESSION_EVENT_TYPES, conductorChildrenProjection, conductorUnavailableRunsProjection } from '@deepseek-ai/dsh-conductor'

/** The standard session store with host-owned Conductor replay registrations. */
export default class ConductorSessionStore extends SessionStore {
  static inject = ['sessionProjections']

  /**
   * Install all replay registrations synchronously before the service activates.
   * @param ctx - provider context with the shared projection registry.
   */
  constructor(ctx: Context) {
    super(ctx)
    this.registerEventTypes(CONDUCTOR_SESSION_EVENT_TYPES)
    ctx.sessionProjections.register(conductorChildrenProjection)
    ctx.sessionProjections.register(conductorUnavailableRunsProjection)
  }
}
