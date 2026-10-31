/** The durable acknowledgement stays visible after the transient composer settles. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { OwnerProvenance } from './ConductorOwnerPanel.tsx'
import css from './ConductorOwnerPanel.module.css'

type OwnerReceiptProps = PropsRuntime<'conversation.chat.node', 'conductor-owner'> & PropsLocale<'question'>

/**
 * Render a recorded waiting, accepted or rejected question without live mutation controls.
 * @param props - exact-question node data and localized copy.
 * @returns durable question identity, status and any recorded answers.
 */
export function ConductorOwnerReceipt({ node, t }: OwnerReceiptProps) {
  const data = node.data
  return <section className={css.receipt} data-conductor-owner-receipt={data.questionId} aria-label={t('conductor.header')}>
    <h3>{t('conductor.header')}</h3>
    <OwnerProvenance owner={data.owner} t={t} />
    <p role="status">{t(`conductor.${data.status}`)}</p>
    <ul>{data.owner.items.map((item) => {
      const answer = data.answers.find(value => value.itemId === item.id)
      return <li key={item.id}>
        <span>{item.prompt}</span>
        {answer !== undefined && <p>{answer.text}</p>}
      </li>
    })}</ul>
  </section>
}
