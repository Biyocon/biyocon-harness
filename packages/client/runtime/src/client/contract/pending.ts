/** Structural pending-interaction types shared by runtime consumers. */
import type {
  ClientResponse, MuxFrame, RpcReceipt, SessionId,
} from '@deepseek-ai/dsh-api-remotes/client'

/** Kind-keyed payload map: requested-frame fields without carrier fields. */
export interface PendingPayloads {
  approval: Omit<Extract<MuxFrame, { type: 'approval/requested' }>, 'type' | 'sessionId'>
  question: Omit<Extract<MuxFrame, { type: 'question/requested' }>, 'type' | 'sessionId'>
}

/** Pending-interaction discriminant. */
export type PendingKind = keyof PendingPayloads

/** Session-list summary of the user action currently blocking progress. */
export type PendingInteractionStatus = 'approval' | 'plan-review' | 'question'

/** Structural read/respond face of one pending host-owned interaction. */
export interface PendingInteractionWait<K extends PendingKind = PendingKind> {
  readonly kind: K
  readonly key: string
  readonly sessionId: SessionId
  readonly payload: PendingPayloads[K]
  respond(result: ClientResponse['result']): Promise<RpcReceipt>
  markSettled(): void
}

/** Kind-discriminated union of concrete pending interactions. */
export type PendingInteraction = { [K in PendingKind]: PendingInteractionWait<K> }[PendingKind]
