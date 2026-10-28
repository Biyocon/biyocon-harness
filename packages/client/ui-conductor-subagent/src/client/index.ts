/** Conductor-owned takeover of generic child catalog text. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-subagent/client'
import type {} from '@deepseek-ai/dsh-conductor/child-types'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import { Content } from './Content.tsx'
import { NS, da, en, type Key } from './locales.ts'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'conductor-child': Key } }
type Owner = PropsRuntime<'subagent.catalog.content'>
/** Select only a host-attributed concrete child. @param owner - slot owner data. @returns the exact child or no takeover. */
function selectChild(owner: Pick<Owner, 'parent' | 'childId'>): ConductorChild | null {
  return owner.parent?.projectionValues?.conductorChildren?.[owner.childId] ?? null
}
/** Client services for localized catalog text. */
export const inject = ['slots', 'locale']
/** Mount the Conductor catalog contribution. @param ctx - client root context. */
export function apply(ctx: ClientContext): void {
  ctx.effect(()=>ctx.locale.register(NS,{ da,en }), 'conductor-child: locale')
  ctx.slots.inject('subagent.catalog.content',()=>ctx.slots.register({ name:'subagent.catalog.content',select:selectChild,locale:NS },Content))
}
