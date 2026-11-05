/** Conductor-owned catalog text renderer. */
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import { NS } from './locales.ts'
import { conductorChildPresentation } from './presentation.ts'
import css from './Content.module.css'
type Owner=PropsRuntime<'subagent.catalog.content'>
/** Render one exact specialist attempt and its lifecycle. @param props - slot owner, locale and matched child. @returns catalog text. */
export function Content(
  { matched, t, nameId, detailId, nameClass, detailClass }: Owner & PropsLocale<typeof NS> & { matched: ConductorChild },
) {
  const view = conductorChildPresentation(matched,t)
  return <>
    <span id={nameId} className={`${nameClass} ${css.identity}`}>{view.label}</span>
    <span id={detailId} className={`${detailClass} ${css.identity}`}>{view.detail} · {matched.childId}</span>
    {matched.gate?.challenge !== undefined && <span className={css.challenge} data-conductor-challenge={matched.childId}>
      <span className={css.text}>{t('challenge.summary')}: {matched.gate.challenge.summary}</span>
      {matched.gate.challenge.findings.length > 0 && <span role="list" aria-label={t('challenge.findings')}>
        {matched.gate.challenge.findings.map(finding => <span role="listitem" key={finding.id} className={css.finding}>
          <span className={css.severity}>{t(`severity.${finding.severity}`)}</span>
          <span className={css.text}>{finding.claim}</span>
          <span className={css.text}>{t('finding.rationale')}: {finding.rationale}</span>
          <span className={css.text}>{t('finding.materials')}: {finding.material_ids.join(', ')}</span>
        </span>)}
      </span>}
    </span>}
  </>
}
