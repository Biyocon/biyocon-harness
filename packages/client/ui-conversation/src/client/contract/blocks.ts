/** Types for the per-session composer-block registry. */
import type { SessionId, SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Why one session's composer is inert. */
export interface ComposerBlock {
  /**
   * Localized placeholder replacing the composer's own, owned by the plugin
   * that raised the block.
   */
  readonly reason: string
}

/** The registry face other plugins reach through `ctx.conversation.blocks`. */
export interface ComposerBlocks {
  /**
   * Raise or clear this session's block. Idempotent: setting a block equal to
   * the current one, or clearing an absent one, notifies nobody.
   * @param sessionId - the session whose composer is affected.
   * @param block - the block to raise, or undefined to clear it.
   */
  set(sessionId: SessionId, block: ComposerBlock | undefined): void
  /**
   * The store the composer subscribes to for one session. Created on first
   * read from either side, so a blocker may raise a block before the session's
   * composer mounts and the composer still sees it.
   * @param sessionId - the session to observe.
   * @returns that session's block store (undefined value = not blocked).
   */
  storeFor(sessionId: SessionId): SnapshotStore<ComposerBlock | undefined>
  /**
   * Drop one session's store. The session scope's disposer calls this; a
   * blocker never needs to.
   * @param sessionId - the session being torn down.
   */
  forget(sessionId: SessionId): void
}
