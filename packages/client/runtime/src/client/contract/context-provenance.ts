/** Presentation types for durable context provenance. */

/** Which model-facing role a logged non-user message plays. */
export type ContextRole = 'inject' | 'recall'

/** Role and producer name presented for one logged non-user message. */
export interface ContextProvenanceView {
  /** The role this context plays in the model-facing conversation. */
  role: ContextRole
  /** Producer name shown in the row header, or null when unavailable. */
  label: string | null
}

/** One durable context form this UI version knows how to present. */
export type KnownContextForm = 'instructions' | 'catalog' | 'snapshot' | 'notice' | 'relay' | 'recall'
