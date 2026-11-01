/** Durable owner-question cards correlated by exact question identity. */
import type {} from '@deepseek-ai/dsh-conductor'
import type { ConversationNodeDefinition } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConductorOwnerQuestion } from './contract/slots.ts'

/** Replayable question and receipt, independent of a live transport request. */
export interface ConductorOwnerHistory {
  questionId: string
  owner: Pick<ConductorOwnerQuestion, 'runId' | 'gate' | 'role' | 'attempt' | 'reason' | 'items'>
  status: 'waiting' | 'accepted' | 'rejected'
  answers: { itemId: string; text: string }[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Durable Conductor owner question and its recorded acknowledgement. */
    'conductor-owner': ConductorOwnerHistory
  }
}

interface OwnerHistoryState extends ConductorOwnerHistory {
  seq: number
  response?: { revision: number; status: 'accepted' | 'rejected'; answers: ConductorOwnerHistory['answers'] }
}
const gates = { detective: 'A', strategist: 'B', 'devils-advocate': 'C', headsman: 'D', auditor: 'E', integrator: 'F', arbiter: 'G' } as const

/** The exact-question fold retains pending and settled cards across browser reloads. */
export const conductorOwnerHistoryDefinition: ConversationNodeDefinition<OwnerHistoryState> = {
  kind: 'conductor-owner',
  target: 'chat',
  match: (event) => {
    switch (event.type) {
      case 'conductor/owner-question-created': return { id: event.data.interaction.question.id, role: 'start' }
      case 'conductor/owner-response-recorded':
      case 'conductor/owner-terminal-rejection': return { id: event.data.interaction.questionId, role: 'update' }
      case 'conductor/owner-response-acknowledged': return { id: event.data.questionId, role: 'update' }
      default: return null
    }
  },
  start: (_context, match) => {
    if (match.event.type !== 'conductor/owner-question-created') throw new Error('Conductor owner history requires a question-created event')
    const q = match.event.data.interaction.question
    if (!(q.stage in gates)) throw new Error('Conductor owner history requires a gated specialist')
    const role = q.stage as keyof typeof gates
    return { questionId: q.id, owner: { runId: q.runId, gate: gates[role], role,
      attempt: q.attempt, reason: q.reason, items: q.items }, status: 'waiting', answers: [], seq: match.event.seq }
  },
  update: (context, match) => {
    if (match.event.type === 'conductor/owner-response-recorded') return {
      ...context.state, response: { revision: match.event.data.interaction.revision,
        status: 'accepted', answers: match.event.data.interaction.answers },
    }
    if (match.event.type === 'conductor/owner-terminal-rejection') return {
      ...context.state, response: { revision: match.event.data.interaction.revision, status: 'rejected', answers: [] },
    }
    if (match.event.type === 'conductor/owner-response-acknowledged') {
      const receipt = match.event.data
      const response = context.state.response
      if (response === undefined || receipt.runId !== context.state.owner.runId
        || receipt.revision !== response.revision || receipt.status !== response.status) {
        throw new Error('Conductor owner acknowledgement contradicts its recorded response')
      }
      return { ...context.state, status: response.status, answers: response.answers }
    }
    return context.state
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    return { key: context.key, id: context.id, kind: 'conductor-owner', target: 'chat', anchorSeq: state.seq,
      location: context.start?.location ?? { kind: 'unresolved' }, visibility: 'visible',
      data: { questionId: state.questionId, owner: state.owner, status: state.status, answers: state.answers } }
  },
}
