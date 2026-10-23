/** Types shared by client Agent-scope consumers. */
import type { Context, Fiber } from '@deepseek-ai/cordis'
import type { TypertClientRemote, TypertRemoteScopeApi } from '@deepseek-ai/dsh-typert-protocol'

/** Client Cordis Context carrying one Agent identity and its scoped Remote namespaces. */
export type AgentContext = Omit<Context, 'remote'> & {
  readonly remote: TypertClientRemote & TypertRemoteScopeApi<'agent'>
}

/** A minted Agent scope and its disposal boundary. */
export interface AgentScopeHandle {
  /** Tagged context used for registrations and scoped dispatch. */
  ctx: AgentContext
  /** Backing fiber; disposing it tears down scope-owned registrations. */
  fiber: Fiber
}
