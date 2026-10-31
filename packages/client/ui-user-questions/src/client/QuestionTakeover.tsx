/** Select typed question takeovers independently of the generic question editor. */
import { useMemo } from 'react'
import {
  PendingQuestion, planReviewOf, conductorOwnerOf,
  type QuestionComposerProps,
} from './contract/slots.ts'
import { ConductorOwnerPanel } from './ConductorOwnerPanel.tsx'
import { PlanReviewPanel } from './PlanReviewPanel.tsx'
import { QuestionFlow } from './QuestionComposer.tsx'

/**
 * Select the typed owner card, plan review or generic flow for one stable carrier.
 * The carrier key preserves local drafts across same-request transport replacement.
 * @param props - the matched question carrier and framework standard kit.
 * @returns the sole composer takeover for this request.
 */
export function QuestionComposer(props: QuestionComposerProps) {
  // Domain-face mint rides the carrier's stable identity (never minted in a
  // select/render dispatch — per-dispatch minting would churn memo identity).
  const question = useMemo(() => new PendingQuestion(props.matched), [props.matched])
  const review = useMemo(() => planReviewOf(question.questions), [question])
  const owner = useMemo(() => conductorOwnerOf(question.questions), [question])
  if (owner !== undefined) return <ConductorOwnerPanel key={question.key} pending={question} owner={owner} t={props.t} />
  return review === undefined
    ? <QuestionFlow key={question.key} pending={question} t={props.t} />
    : <PlanReviewPanel key={question.key} pending={question} review={review} t={props.t} />
}
