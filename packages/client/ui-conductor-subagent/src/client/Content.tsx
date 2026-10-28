/** Conductor-owned catalog text renderer. */
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import { NS } from './locales.ts'
import { conductorChildPresentation } from './presentation.ts'
type Owner=PropsRuntime<'subagent.catalog.content'>
/** Render one exact specialist attempt and its lifecycle. @param props - slot owner, locale and matched child. @returns catalog text. */
export function Content(
  { matched, t, nameId, detailId, nameClass, detailClass }: Owner & PropsLocale<typeof NS> & { matched: ConductorChild },
) {
  const view = conductorChildPresentation(matched,t)
  return <>
    <span id={nameId} className={nameClass}>{view.label}</span>
    <span id={detailId} className={detailClass}>{view.detail} · {matched.childId}</span>
  </>
}
