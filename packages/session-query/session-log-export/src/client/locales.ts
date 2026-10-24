/** Locale namespace owned by Session export browser feedback. */
export const NS = 'session-log-download'

/** Danish Session export strings. */
export const da = {
  'dialog.preparingTitle': 'Eksporterer session',
  'dialog.preparingDescription': 'Forbereder en ZIP-fil med denne session, dens undersessioner og vedhæftninger.',
  'dialog.successTitle': 'Download af session er startet',
  'dialog.successDescription': 'Browseren downloader sessionens ZIP-fil.',
  'dialog.errorTitle': 'Sessionseksport mislykkedes',
  'dialog.close': 'Luk',
  'dialog.commandFailed': 'Kunne ikke starte sessionseksport.',
} as const

/** English Session export strings. */
export const en: Record<keyof typeof da, string> = {
  'dialog.preparingTitle': 'Exporting Session',
  'dialog.preparingDescription': 'Preparing a ZIP containing this Session, its sub-Sessions, and attachments.',
  'dialog.successTitle': 'Session download started',
  'dialog.successDescription': 'The browser is downloading the Session ZIP.',
  'dialog.errorTitle': 'Session export failed',
  'dialog.close': 'Close',
  'dialog.commandFailed': 'Could not start the Session export.',
}

/** Stable locale keys consumed by the shared modal. */
export type SessionLogDownloadKey = keyof typeof da
