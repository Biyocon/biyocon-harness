/** Conductor child presentation dictionaries. */
export const NS = 'conductor-child'
/** Danish role and lifecycle text. */
export const da = {
  'attempt': 'forsøg {attempt}',
  'gate': 'Gate {gate}: {decision}',
  'gate.abort': 'afbrudt',
  'gate.escalate': 'eskaleret',
  'gate.pass': 'bestået',
  'gate.rework': 'rework {used}/{limit}',
  'role.arbiter': 'The Arbiter',
  'role.auditor': 'Auditor',
  'role.detective': 'Detective',
  'role.devils-advocate': 'Devil’s Advocate',
  'role.headsman': 'Headsman',
  'role.integrator': 'Integrator',
  'role.ralph': 'Ralph-arbejder',
  'role.strategist': 'Strategist',
  'status.completed': 'færdig',
  'status.failed': 'fejlet',
  'status.running': 'kører',
} as const
/** Dictionary keys shared by both supported locales. */
export type Key = keyof typeof da
/** English role and lifecycle text with the same keys. */
export const en: Record<Key, string> = {
  'attempt': 'attempt {attempt}',
  'gate': 'Gate {gate}: {decision}',
  'gate.abort': 'aborted',
  'gate.escalate': 'escalated',
  'gate.pass': 'pass',
  'gate.rework': 'rework {used}/{limit}',
  'role.arbiter': 'The Arbiter',
  'role.auditor': 'Auditor',
  'role.detective': 'Detective',
  'role.devils-advocate': 'Devil’s Advocate',
  'role.headsman': 'Headsman',
  'role.integrator': 'Integrator',
  'role.ralph': 'Ralph-worker',
  'role.strategist': 'Strategist',
  'status.completed': 'completed',
  'status.failed': 'failed',
  'status.running': 'running',
}
