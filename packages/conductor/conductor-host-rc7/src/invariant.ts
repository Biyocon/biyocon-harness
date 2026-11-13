/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-conductor-host-rc7`.
 * @module @deepseek-ai/dsh-conductor-host-rc7/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-conductor-host-rc7'

/** Cordis companion plugin name. */
export const name = 'conductor-host-rc7-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

// No runtime invariant: the provider composes SessionStore and existing Conductor
// registrations without a new record or mutable domain relation. Session and
// Conductor invariants own the resulting log and projection relationships.
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
