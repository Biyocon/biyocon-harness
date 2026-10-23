/** Runtime values for the client conversation snapshot contract. */
import type { ContentBlock } from '@deepseek-ai/dsh-llm/types'
import type {
  AssistantBlock, ChatSnapshot,
} from './contract/session-snapshot.ts'
import type {
  ConversationTimelineSnapshot, ConversationViewSnapshotStore,
} from './contract/conversation.ts'

/**
 * Classify core content blocks for the UI.
 * @param content - core content blocks verbatim.
 * @returns UI-classified blocks in source order.
 */
export function toAssistantBlocks(content: readonly ContentBlock[]): AssistantBlock[] {
  return content.map(toAssistantBlock)
}

/**
 * Classify one core content block.
 * @param block - one core content block.
 * @returns the UI classification.
 */
export function toAssistantBlock(block: ContentBlock): AssistantBlock {
  switch (block.type) {
    case 'text': return { kind: 'text', text: block.text }
    case 'reasoning': return { kind: 'reasoning', text: block.text }
    case 'image': return { kind: 'image', attachment: block.attachment }
    case 'tool-call': return { kind: 'tool-call', callId: String(block.id), name: block.name, argsRaw: block.arguments }
    default: return { kind: 'other', block }
  }
}

const EMPTY_LIST: readonly never[] = []
const EMPTY_TIMELINE: ConversationTimelineSnapshot = { turnOrder: EMPTY_LIST, turns: new Map() }

/** Empty target store used by fixtures and Sessions without registered views. */
export const EMPTY_CONVERSATION_VIEWS: ConversationViewSnapshotStore = {
  get: () => undefined,
}

/** Empty Chat target used before a view builder is registered. */
export const EMPTY_CHAT_SNAPSHOT: ChatSnapshot = {
  order: EMPTY_LIST,
  nodes: {
    get: () => undefined,
    values: () => EMPTY_LIST,
  },
  locations: {
    getTurn: () => EMPTY_LIST,
    getStep: () => EMPTY_LIST,
  },
  timeline: EMPTY_TIMELINE,
  legacy: {
    nodes: EMPTY_LIST,
    turnTimings: new Map(),
    turnEnds: new Map(),
    partial: null,
    runningCalls: EMPTY_LIST,
  },
}
