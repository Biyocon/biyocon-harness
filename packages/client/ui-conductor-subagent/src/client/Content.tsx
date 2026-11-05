/** Conductor-owned catalog text renderer. */
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import { NS } from './locales.ts'
import { conductorChildPresentation } from './presentation.ts'
import css from './Content.module.css'
import clsx from 'clsx'
type Owner=PropsRuntime<'subagent.catalog.content'>
/** Render one exact specialist attempt and its lifecycle. @param props - slot owner, locale and matched child. @returns catalog text. */
export function Content(
  { matched, t, nameId, detailId, nameClass, detailClass }: Owner & PropsLocale<typeof NS> & { matched: ConductorChild },
) {
  const view = conductorChildPresentation(matched,t)
  const challenge = matched.gate?.challenge?.result
  return <>
    <span id={nameId} className={clsx(nameClass, css.identity)}>{view.label}</span>
    <span id={detailId}>
      <span className={clsx(detailClass, css.identity)}>{view.detail} · {matched.childId}</span>
      {challenge !== undefined && <span className={css.challenge} data-conductor-challenge={matched.childId}>
        <span className={css.text}>{t('challenge.summary')}: {challenge.summary}</span>
        {challenge.findings.length > 0 && <><span className={css.text}>{t('challenge.findings')}</span><span role="list">
          {challenge.findings.map(finding => <span role="listitem" key={finding.id} className={css.finding}>
            <span className={css.severity}>{t(`severity.${finding.severity}`)}</span>
            <span className={css.text}>{finding.claim}</span>
            <span className={css.text}>{t('finding.rationale')}: {finding.rationale}</span>
            <span className={css.text}>{t('finding.materials')}: {finding.material_ids.join(', ')}</span>
          </span>)}
        </span></>}
      </span>}
    </span>
  </>
}
