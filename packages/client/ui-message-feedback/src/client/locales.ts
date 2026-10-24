/** `feedback` namespace dictionaries. */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'action.like': 'Godt svar',
  'action.likeActive': 'Fjern vurdering',
  'action.dislike': 'Dårligt svar',
  'action.dislikeActive': 'Fjern vurdering',
  'note.open': 'Tilføj en note',
  'note.placeholder': 'Hvad var godt, eller hvad gik galt? (valgfrit)',
  'note.save': 'Gem',
  'note.cancel': 'Annuller',
  'note.aria': 'Feedbacknote',
  'error.conflict': 'Denne feedback blev ændret et andet sted; den seneste version vises',
  'error.load': 'Kunne ikke indlæse feedback',
  'error.generic': 'Kunne ikke gemme feedback',
} satisfies Record<string, string>

/** The feedback namespace key union. */
export type MessageFeedbackKey = keyof typeof da

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The per-message feedback controls' copy. */
    feedback: MessageFeedbackKey
  }
}

/** English dictionary, checked complete against the da key set. */
export const en = {
  'action.like': 'Good response',
  'action.likeActive': 'Remove rating',
  'action.dislike': 'Bad response',
  'action.dislikeActive': 'Remove rating',
  'note.open': 'Add a note',
  'note.placeholder': 'What was good, or what went wrong? (optional)',
  'note.save': 'Save',
  'note.cancel': 'Cancel',
  'note.aria': 'Feedback note',
  'error.conflict': 'This feedback changed elsewhere; the latest state is shown',
  'error.load': 'Could not load feedback',
  'error.generic': 'Could not save feedback',
} satisfies Record<MessageFeedbackKey, string>
