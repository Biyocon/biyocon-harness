/** `job` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'job'

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'count.live.one': '{count} baggrundsjob kører',
  'count.live.other': '{count} baggrundsjob kører',
  'count.idle.one': '{count} baggrundsjob',
  'count.idle.other': '{count} baggrundsjob',
  'list.aria': 'Baggrundsjob',
  'status.running': 'kører',
  'status.stopping': 'stopper',
  'status.completed': 'fuldført',
  'status.killed': 'annulleret',
  'status.failed': 'mislykkedes',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours} t {minutes} min',
  'duration.title.live': 'Har kørt i {duration}',
  'duration.title.done': 'Tog {duration}',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<JobKey, string> = {
  'count.live.one': '{count} background job running',
  'count.live.other': '{count} background jobs running',
  'count.idle.one': '{count} background job',
  'count.idle.other': '{count} background jobs',
  'list.aria': 'Background jobs',
  'status.running': 'running',
  'status.stopping': 'stopping',
  'status.completed': 'completed',
  'status.killed': 'cancelled',
  'status.failed': 'failed',
  'duration.seconds': '{seconds}s',
  'duration.minutes': '{minutes}m {seconds}s',
  'duration.hours': '{hours}h {minutes}m',
  'duration.title.live': 'Running for {duration}',
  'duration.title.done': 'Took {duration}',
}

/** Key domain of the `job` namespace (da is the source of truth). */
export type JobKey = keyof typeof da
