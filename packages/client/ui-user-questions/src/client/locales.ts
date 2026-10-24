/** `question` namespace dictionaries. */

/** Danish dictionary (the key-set source of truth). */
export const da = {
  'error.incomplete': 'Besvar venligst dette spørgsmål først.',
  'error.unanswered': 'Vælg en mulighed, eller skriv dit eget svar.',
  'nav.prev': 'Forrige spørgsmål',
  'nav.next': 'Næste spørgsmål',
  'nav.minimize': 'Fold spørgsmålskortet sammen',
  'nav.maximize': 'Fold spørgsmålskortet ud',
  'nav.cancel': 'Luk alle spørgsmål',
  'option.recommended': 'Anbefalet',
  'custom.placeholder': 'Skriv dit svar',
  'action.skip': 'Spring dette spørgsmål over',
  'action.next': 'Næste',
  'plan.header': 'Plangennemgang',
  'plan.approve': 'Godkend',
  'plan.decline': 'Afvis',
  'plan.discuss': 'Drøft planen',
} satisfies Record<string, string>

/** The question namespace key union. */
export type QuestionKey = keyof typeof da

/** English dictionary, checked complete against the da key set. */
export const en = {
  'error.incomplete': 'Please complete this question first.',
  'error.unanswered': 'Please select an option or enter a custom answer.',
  'nav.prev': 'Previous question',
  'nav.next': 'Next question',
  'nav.minimize': 'Collapse the question card',
  'nav.maximize': 'Expand the question card',
  'nav.cancel': 'Dismiss all questions',
  'option.recommended': 'Recommended',
  'custom.placeholder': 'Type your answer',
  'action.skip': 'Skip this question',
  'action.next': 'Next',
  'plan.header': 'Plan review',
  'plan.approve': 'Approve',
  'plan.decline': 'Refuse',
  'plan.discuss': 'Chat about it',
} satisfies Record<QuestionKey, string>
