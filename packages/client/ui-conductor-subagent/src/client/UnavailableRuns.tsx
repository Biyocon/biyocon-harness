/** Localized read-only notice for saved Conductor runs that cannot be used. */
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-conductor/run-availability-types'
import { NS } from './locales.ts'
import css from './UnavailableRuns.module.css'

type HeaderProps = PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>
type DockProps = PropsRuntime<'conversation.input.dock'> & PropsLocale<typeof NS>

function entries(props: HeaderProps | DockProps) {
  const runs = props.useSessions(state => state.byId[props.sessionId]?.projectionValues?.conductorUnavailableRuns)
  return Object.entries(runs ?? {}).sort(([left], [right]) => left.localeCompare(right))
}

function message(format: number | null, t: HeaderProps['t']): string {
  return format === null ? t('unavailable.unknown') : t('unavailable', { format })
}

/** Persistent session-header status, including while Forløb is selected. */
export function UnavailableRunsHeader(props: HeaderProps) {
  const runs = entries(props)
  if (runs.length === 0) return null
  return <span className={css.header} role="status" data-conductor-unavailable-header>
    {runs.map(([runId, run]) => <span key={runId}>{props.t('unavailable.title')} {runId}: {message(run.format, props.t)}</span>)}
  </span>
}

/** Conductor status panel above the composer, with no action on the old run. */
export function UnavailableRunsPanel(props: DockProps) {
  const runs = entries(props)
  if (runs.length === 0) return null
  return <section className={css.panel} aria-label={props.t('unavailable.title')} data-conductor-unavailable-panel>
    {runs.map(([runId, run]) => <p key={runId}>{runId}: {message(run.format, props.t)}</p>)}
  </section>
}
