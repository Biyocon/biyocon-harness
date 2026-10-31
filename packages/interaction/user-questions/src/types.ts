/**
 * Wire-safe question and answer types, free of cordis/service imports so browser
 * type chains (apiproxy api → client) can consume them without loading this
 * package's Context augmentation.
 * @module @deepseek-ai/dsh-user-questions/types
 */

/** One selectable answer offered to the user. */
export interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}

/**
 * Caller-declared presentation or typed owner interaction. A plan review keeps
 * the generic answer encoding and changes presentation only. A Conductor owner
 * question uses the dedicated machine-action response and durable host acceptance;
 * translated labels never supply authority.
 */
export type AskUserQuestionIntent = ConductorOwnerIntent | {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}


/** Exact normalized authority shown by the host; text answers cannot replace these fields. */
export interface ConductorOwnerMandate {
  allowedPaths: string[]
  excludedPaths: string[]
  qualityCommandIds: string[]
}

/** Host-projected Conductor owner interaction, separate from plan approval. */
export interface ConductorOwnerIntent {
  kind: 'conductor-owner'
  /** An already durable answer whose reserved plan awaits an explicit owner gesture. */
  mode?: 'continuation'
  runId: string
  questionId: string
  revision: number
  gate: 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G'
  role: 'detective' | 'strategist' | 'devils-advocate' | 'headsman' | 'auditor' | 'integrator' | 'arbiter'
  attempt: number
  reason: string
  items: { id: string; prompt: string; options: string[] }[]
  proposal?: { before: ConductorOwnerMandate; after: ConductorOwnerMandate; hash: string }
}

/** Machine action and complete required answers; localized labels never grant authority. */
export interface ConductorOwnerAnswer {
  questionId: string
  revision: number
  action: 'approve' | 'reject' | 'answer_continue'
  answers: { itemId: string; text: string; optionId?: string }[]
  proposalHash?: string
}

/** One question in a user-questions request. */
export interface AskUserQuestionItem {
  /** Stable caller-provided question id, echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail rendered with the question but kept out of option labels. */
  detail?: string
  /** Optional short heading/group label. */
  header?: string
  /** Optional choices the UI can render as a menu. */
  options?: AskUserQuestionOption[]
  /** Whether more than one option may be selected. Defaults to single-select. */
  multiSelect?: boolean
  /** Optional presentation intent for capable UIs; absent asks for the generic option list. */
  intent?: AskUserQuestionIntent
}

/** Answer to one question. */
export interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}

/** The human's answer. */
export interface AskUserQuestionAnswer {
  /** Present only for the dedicated Conductor interaction; generic answers stay empty. */
  conductor?: ConductorOwnerAnswer
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
