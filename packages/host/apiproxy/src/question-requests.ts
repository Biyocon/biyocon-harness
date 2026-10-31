/**
 * Host-owned question RPC lifecycle: binding, validation and durable acceptance.
 * @module @deepseek-ai/dsh-host-apiproxy/question-requests
 */
import { randomUUID } from 'node:crypto'
import type { AskUserQuestionAnswer, AskUserQuestionItem, AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import { UserQuestionError } from '@deepseek-ai/dsh-user-questions'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { MuxFrame } from './api/events.ts'
import type { QuestionResponsePayload } from './api/questions.ts'
import { questionResponsePayloadSchema } from './api/questions.schema.ts'
import { RpcId } from './api/rpc.ts'
import type { ClientResponse, RpcReceipt, RpcRequest } from './api/rpc.ts'

/** One question request retains its exact consumer callback until durable settlement. */
interface PendingQuestion {
  rpcId: RpcId
  sessionId: SessionId
  questions: AskUserQuestionItem[]
  accept?: (answer: AskUserQuestionAnswer) => Promise<void>
  accepting?: { answer: AskUserQuestionAnswer; receipt: Promise<RpcReceipt> }
  resolve: (answer: AskUserQuestionAnswer) => void
  reject: (error: UserQuestionError) => void
  signal?: AbortSignal
  onAbort?: () => void
}

type Requested = RpcRequest<Extract<MuxFrame, { type: 'question/requested' }>>
type Resolved = Extract<MuxFrame, { type: 'question/resolved' }>

/** Validate one answer batch against the exact question request it resolves. */
function matchesQuestions(payload: QuestionResponsePayload, pending: PendingQuestion): boolean {
  if (payload.sessionId !== pending.sessionId) return false
  const intent = pending.questions.length === 1 ? pending.questions[0]?.intent : undefined
  if (intent?.kind === 'conductor-owner') {
    return payload.answer.answers.length === 0 && payload.answer.conductor !== undefined
      && payload.answer.conductor.questionId === intent.questionId
      && payload.answer.conductor.revision === intent.revision
  }
  if (payload.answer.conductor !== undefined) return false
  const answers = payload.answer.answers
  if (answers.length !== pending.questions.length) return false
  return answers.every((answer, index) => {
    const question = pending.questions[index] as AskUserQuestionItem
    if (answer.id !== question.id) return false
    if (new Set(answer.selected).size !== answer.selected.length) return false
    const custom = answer.custom?.trim()
    if (custom !== undefined && custom === '') return false
    if (question.multiSelect !== true) {
      if (custom !== undefined && answer.selected.length > 0) return false
      if (answer.selected.length > 1) return false
    }
    const labels = new Set(question.options?.map(option => option.label) ?? [])
    return answer.selected.every(label => labels.has(label))
  })
}

/**
 * One API host's pending question registry. Consumer acceptance remains bound to
 * the exact request; responses never select another callback or resume plan.
 */
export class QuestionRequests {
  private readonly pending = new Map<RpcId, PendingQuestion>()

  /**
   * @param requested - publish a new answerable request to currently connected clients.
   * @param resolved - publish a claimed or cancelled request after removing it.
   */
  constructor(private readonly requested: (request: Requested) => void, private readonly resolved: (result: Resolved) => void) {}

  /**
   * Capture the exact owner's question and consumer acceptance callback.
   * @param request - live root-owned request admitted by the question service.
   * @returns the answer after successful consumer acceptance, or a cancellation rejection.
   */
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer> {
    const sessionId = request.agent?.id
    if (sessionId === undefined) return Promise.reject(new UserQuestionError(
      'web user interaction requires an agent-owned session', 'ASK_MISSING_AGENT'))
    return new Promise<AskUserQuestionAnswer>((resolve, reject) => {
      const rpcId = RpcId(randomUUID())
      const pending: PendingQuestion = { rpcId, sessionId, questions: request.questions, resolve, reject,
        ...(request.accept === undefined ? {} : { accept: request.accept }),
        ...(request.signal === undefined ? {} : { signal: request.signal }) }
      const onAbort = (): void => {
        this.claim(pending, 'cancelled')
        reject(new UserQuestionError('ask_user_question was aborted before the user answered', 'ASK_ABORTED'))
      }
      pending.onAbort = onAbort
      this.pending.set(rpcId, pending)
      request.signal?.addEventListener('abort', onAbort, { once: true })
      this.requested(this.requestFrame(pending))
    })
  }

  /**
   * Return the same still-pending request identities after browser reconnection.
   * @returns answerable frames with their original RPC ids and exact questions.
   */
  frames(): Requested[] {
    return [...this.pending.values()].map(pending => this.requestFrame(pending))
  }

  /** Reject every pending consumer when this host's provider is disposed. */
  dispose(): void {
    for (const pending of [...this.pending.values()]) {
      this.claim(pending, 'cancelled')
      pending.reject(new UserQuestionError('web user-questions provider was disposed', 'ASK_ABORTED'))
    }
  }

  private requestFrame(pending: PendingQuestion): Requested {
    return { rpcId: pending.rpcId, payload: { type: 'question/requested', sessionId: pending.sessionId, questions: pending.questions } }
  }

  private claim(pending: PendingQuestion, outcome: 'answered' | 'cancelled'): void {
    this.pending.delete(pending.rpcId)
    if (pending.signal !== undefined && pending.onAbort !== undefined) pending.signal.removeEventListener('abort', pending.onAbort)
    this.resolved({ type: 'question/resolved', sessionId: pending.sessionId, questionRpcId: pending.rpcId, outcome })
  }

  /**
   * Validate and settle one response against its exact request. Identical in-flight
   * replies share the pending receipt; conflicts cannot replace its private callback.
   * @param message - decoded RPC envelope with an untrusted response value.
   * @returns acceptance only after the consumer commits, while failed acceptance stays pending.
   */
  respond(message: ClientResponse): Promise<RpcReceipt> {
    const pending = this.pending.get(message.rpcId)
    if (pending === undefined) return Promise.resolve({ accepted: false, reason: 'not-pending' })
    if (!message.result.ok) {
      if (message.result.error.code !== 'cancelled') return Promise.resolve({ accepted: false, reason: 'bad-response' })
      this.claim(pending, 'cancelled')
      pending.reject(new UserQuestionError('the user cancelled ask_user_question', 'ASK_CANCELLED'))
      return Promise.resolve({ accepted: true })
    }
    const parsed = questionResponsePayloadSchema.safeParse(message.result.value)
    if (!parsed.success) return Promise.resolve({ accepted: false, reason: 'bad-response' })
    const payload: QuestionResponsePayload = {
      sessionId: parsed.data.sessionId,
      answer: {
        ...(parsed.data.answer.conductor === undefined ? {} : { conductor: {
          questionId: parsed.data.answer.conductor.questionId, revision: parsed.data.answer.conductor.revision,
          action: parsed.data.answer.conductor.action,
          answers: parsed.data.answer.conductor.answers.map(item => ({ itemId: item.itemId, text: item.text,
            ...(item.optionId === undefined ? {} : { optionId: item.optionId }) })),
          ...(parsed.data.answer.conductor.proposalHash === undefined ? {} : { proposalHash: parsed.data.answer.conductor.proposalHash }),
        } }),
        answers: parsed.data.answer.answers.map(answer => ({ id: answer.id, selected: answer.selected,
          ...(answer.custom === undefined ? {} : { custom: answer.custom }) })),
      },
    }
    if (!matchesQuestions(payload, pending)) return Promise.resolve({ accepted: false, reason: 'bad-response' })
    if (pending.accepting !== undefined) return JSON.stringify(pending.accepting.answer) === JSON.stringify(payload.answer)
      ? pending.accepting.receipt : Promise.resolve({ accepted: false, reason: 'bad-response' })
    if (pending.accept !== undefined) {
      const accept = pending.accept
      const receipt = (async (): Promise<RpcReceipt> => {
        try { await accept(payload.answer) } catch {
          // The consumer owns durable validation; a rejected answer leaves the question pending.
          return { accepted: false, reason: 'bad-response' }
        }
        if (this.pending.get(pending.rpcId) !== pending) return { accepted: false, reason: 'not-pending' }
        this.claim(pending, 'answered')
        pending.resolve(payload.answer)
        return { accepted: true }
      })()
      pending.accepting = { answer: payload.answer, receipt }
      void receipt.then(() => { delete pending.accepting })
      return receipt
    }
    this.claim(pending, 'answered')
    pending.resolve(payload.answer)
    return Promise.resolve({ accepted: true })
  }
}
