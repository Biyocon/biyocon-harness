/** Typed owner responses; labels never determine the submitted machine action. */
import { useState } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ConductorOwnerQuestion, PendingQuestion, QuestionAnswer, QuestionComposerProps } from './contract/slots.ts'
import css from './ConductorOwnerPanel.module.css'

type Copy = Pick<QuestionComposerProps, 't'>
type OwnerResponse = NonNullable<QuestionAnswer['conductor']>

/**
 * Render the exact host-issued run, gate and child identity.
 * @param props - typed provenance and the package's locale seat.
 * @returns visible provenance without parsing role names from prompts.
 */
export function OwnerProvenance({ owner, t }: { owner: Pick<ConductorOwnerQuestion, 'runId' | 'gate' | 'role' | 'attempt' | 'reason'> } & Copy) {
  return <>
    <div className={css.identity}>
      <span>{t('conductor.run')}: <code>{owner.runId}</code></span>
      <span>{t('conductor.gate')} {owner.gate}</span>
      <span>{t(`conductor.role.${owner.role}`)} · {t('conductor.attempt')} {owner.attempt}</span>
    </div>
    <p className={css.reason}>{owner.reason}</p>
  </>
}

/**
 * Preview every effective path and command ID, including removals.
 * @param props - complete before/after mandate, not an inferred patch.
 * @returns the exact host-validated amendment preview.
 */
export function OwnerProposal({ proposal, t }: { proposal: NonNullable<ConductorOwnerQuestion['proposal']> } & Copy) {
  const rows = [
    ['allowedPaths', 'conductor.allowed'],
    ['excludedPaths', 'conductor.excluded'],
    ['qualityCommandIds', 'conductor.commands'],
  ] as const
  return <section className={css.proposal} aria-label={t('conductor.proposal')}>
    <h3>{t('conductor.proposal')}</h3>
    <table>
      <thead><tr><th scope="col">{t('conductor.proposal')}</th><th scope="col">{t('conductor.before')}</th><th scope="col">{t('conductor.after')}</th></tr></thead>
      <tbody>{rows.map(([key, label]) => <tr key={key}>
        <th scope="row">{t(label)}</th>
        {(['before', 'after'] as const).map(side => <td key={side}>
          {proposal[side][key].length === 0 ? t('conductor.none') : <ul>{proposal[side][key].map(value => <li key={value}><code>{value}</code></li>)}</ul>}
        </td>)}
      </tr>)}</tbody>
    </table>
  </section>
}

/**
 * Collect one atomic owner answer; dismissal, Enter in text and blank fields grant nothing.
 * @param props - host intent, pending transport and localized copy.
 * @returns the Conductor-specific card, separate from generic questions and plan review.
 */
export function ConductorOwnerPanel({ pending, owner, t }: { pending: PendingQuestion; owner: ConductorOwnerQuestion } & Copy) {
  const continuation = owner.mode === 'continuation'
  const [answers, setAnswers] = useState<Record<string, { text: string; optionId?: string }>>({})
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = continuation || owner.items.every((item) => {
    const answer = answers[item.id]
    return answer !== undefined && answer.text.trim() !== ''
      && (item.options.length === 0 || item.options.includes(answer.optionId ?? ''))
  })
  const decide = (action: OwnerResponse['action']): void => {
    const response: OwnerResponse = {
      questionId: owner.questionId, revision: owner.revision, action,
      answers: action === 'reject' || continuation ? [] : owner.items.map((item) => {
        // Every non-rejection control is disabled until these drafts are complete.
        const answer = answers[item.id] as { text: string; optionId?: string }
        return { itemId: item.id, text: answer.text.trim(),
          ...(answer.optionId === undefined ? {} : { optionId: answer.optionId }) }
      }),
      ...(action !== 'reject' && !continuation && owner.proposal !== undefined ? { proposalHash: owner.proposal.hash } : {}),
    }
    setBusy(true)
    setError(null)
    void pending.answer({ answers: [], conductor: response }).catch((cause: unknown) => {
      setBusy(false)
      setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  return <div className={css.frame} data-conductor-owner-question={owner.questionId}>
    <section className={css.card} aria-label={t('conductor.header')}>
      <header className={css.header}><h2>{t('conductor.header')}</h2><span role="status">{t(continuation ? 'conductor.accepted' : 'conductor.waiting')}</span></header>
      <div className={css.body}>
        <OwnerProvenance owner={owner} t={t} />
        <p className={css.safety}>{t('conductor.safety')}</p>
        {owner.proposal !== undefined && <OwnerProposal proposal={owner.proposal} t={t} />}
        {continuation ? <ul>{owner.items.map(item => <li key={item.id}>{item.prompt}</li>)}</ul> : owner.items.map((item) => {
          const inputId = `${pending.key}-${item.id}`
          return <div key={item.id} className={css.item}>
            <label htmlFor={inputId}>{item.prompt} <span>({t('conductor.required')})</span></label>
            {item.options.length === 0
              ? <textarea id={inputId} required rows={2} disabled={busy} value={answers[item.id]?.text ?? ''}
                onChange={(event) => { setAnswers(current => ({ ...current, [item.id]: { text: event.target.value } })) }} />
              : <select id={inputId} required disabled={busy} value={answers[item.id]?.optionId ?? ''}
                onChange={(event) => {
                  const optionId = event.target.value
                  setAnswers(current => ({ ...current, [item.id]: { text: optionId, optionId } }))
                }}>
                <option value="" disabled>{t('conductor.choose')}</option>
                {item.options.map(option => <option key={option} value={option}>{option}</option>)}
              </select>}
          </div>
        })}
        {!continuation && owner.proposal !== undefined && <label className={css.confirm}>
          <input type="checkbox" checked={confirmed} disabled={busy} onChange={(event) => { setConfirmed(event.target.checked) }} />
          {t('conductor.confirm')}
        </label>}
      </div>
      <footer className={css.footer}>
        <p role="alert" className={css.error}>{error}</p>
        <div className={css.actions}>
          {!continuation && <Button variant="outline" disabled={busy} onClick={() => { decide('reject') }}>{t('conductor.reject')}</Button>}
          {!continuation && owner.proposal !== undefined && <Button variant="outline" disabled={busy || !complete || !confirmed} onClick={() => { decide('approve') }}>{t('conductor.approve')}</Button>}
          <Button variant="primary" disabled={busy || !complete || !continuation && owner.proposal !== undefined && !confirmed} onClick={() => { decide('answer_continue') }}>{t('conductor.continue')}</Button>
        </div>
      </footer>
    </section>
  </div>
}
