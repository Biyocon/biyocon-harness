/** Localized presentation of host-attributed Conductor child sessions. */
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { NS } from './locales.ts'

/**
 * Format one concrete child without consulting its prompt or generated title.
 * @param child - host-attributed identity and optional gate verdict.
 * @param t - active UI locale.
 * @returns localized title and lifecycle/verdict text.
 */
export function conductorChildPresentation(child: ConductorChild, t: TranslateNS<typeof NS>): { label: string; detail: string } {
  const label = [t(`role.${child.role}`), child.mode === undefined ? undefined : t(`mode.${child.mode}`),
    t('attempt', { attempt: child.attempt })].filter(value => value !== undefined).join(' · ')
  const gate = child.gate === undefined ? undefined : t('gate', {
    gate: child.gate.id,
    decision: child.gate.decision === 'rework'
      ? t('gate.rework', { used: child.gate.reworks, limit: child.gate.limit })
      : t(`gate.${child.gate.decision}`),
  })
  const challenge = child.gate?.challengeConclusion === undefined
    ? child.mode === 'critic' && child.gate === undefined && child.status !== 'failed' ? t('challenge.pending') : undefined
    : t(`challenge.${child.gate.challengeConclusion}`)
  return { label, detail: [t(`status.${child.status}`), gate, challenge].filter(value => value !== undefined).join(' · ') }
}
