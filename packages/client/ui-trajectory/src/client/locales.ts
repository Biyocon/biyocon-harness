/** `trajectory` namespace dictionaries (view tab label + toolbar strings). */

/** Dictionary namespace owned by this plugin. */
export const NS = 'trajectory'

/** The trajectory dictionary key set (the source of truth for both locales). */
export type TrajectoryKey =
  | 'view.trajectory'
  | 'toolbar.aria'
  | 'toolbar.duration'
  | 'toolbar.useActualDuration'
  | 'toolbar.useEqualWidth'
  | 'toolbar.actualTime'
  | 'toolbar.turns'
  | 'toolbar.expandTurns'
  | 'toolbar.collapseTurns'
  | 'toolbar.calls'
  | 'toolbar.expandCalls'
  | 'toolbar.collapseCalls'
  | 'toolbar.search'
  | 'toolbar.searchPlaceholder'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The trajectory view tab label and toolbar strings. */
    'trajectory': TrajectoryKey
  }
}

/** Danish dictionary (the key-set source of truth). */
export const da: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Forløb',
  'toolbar.aria': 'Værktøjslinje til forløb',
  'toolbar.duration': 'Varighed',
  'toolbar.useActualDuration': 'Brug faktisk varighed',
  'toolbar.useEqualWidth': 'Brug lige brede handlinger',
  'toolbar.actualTime': 'Faktisk tid',
  'toolbar.turns': 'Ture',
  'toolbar.expandTurns': 'Fold ture ud',
  'toolbar.collapseTurns': 'Fold ture sammen',
  'toolbar.calls': 'Kald',
  'toolbar.expandCalls': 'Fold kald ud',
  'toolbar.collapseCalls': 'Fold kald sammen',
  'toolbar.search': 'Søg i forløb',
  'toolbar.searchPlaceholder': 'Søg',
}

/** English dictionary. */
export const en: Record<TrajectoryKey, string> = {
  'view.trajectory': 'Trajectory',
  'toolbar.aria': 'Trajectory toolbar',
  'toolbar.duration': 'Duration',
  'toolbar.useActualDuration': 'Use actual duration',
  'toolbar.useEqualWidth': 'Use equal-width operations',
  'toolbar.actualTime': 'Actual time',
  'toolbar.turns': 'Turns',
  'toolbar.expandTurns': 'Expand turns',
  'toolbar.collapseTurns': 'Collapse turns',
  'toolbar.calls': 'Calls',
  'toolbar.expandCalls': 'Expand calls',
  'toolbar.collapseCalls': 'Collapse calls',
  'toolbar.search': 'Search trajectory',
  'toolbar.searchPlaceholder': 'Search',
}
