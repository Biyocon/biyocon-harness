# User Interaction

English | [中文](user-questions.zh.md)

The user-questions seam of [dsh-user-questions](../../packages/interaction/user-questions). It is the provider-neutral vocabulary a tool or permission plugin uses when it needs the human to answer before the agent can continue. UI surfaces provide the active `UserQuestionProvider`; the host runtime relays requests to its connected client.

Source: [`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## Question options

`AskUserQuestionOption` contains one selectable choice. `label` is the user-facing option text and also the model-facing selected value; `description` is optional UI help text.

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## Presentation intent

`AskUserQuestionIntent` distinguishes plan review from the typed Conductor owner interaction. For `plan-review`, `approve` names the affirmative option rather than relying on order; `ask()` rejects an absent matching option or missing `detail`. `conductor-owner` carries the dedicated machine-action protocol below instead of reusing plan option labels.

```ts type-equiv
/**
 * Caller-declared presentation or typed owner interaction. A plan review keeps
 * the generic answer encoding and changes presentation only. A Conductor owner
 * question uses the dedicated machine-action response and durable host acceptance;
 * translated labels never supply authority.
 */
type AskUserQuestionIntent = ConductorOwnerIntent | {
  /** A plan submitted for review: `detail` is the plan markdown `ask()` requires, and the decision approves or declines it. */
  kind: 'plan-review'
  /**
   * The option label that approves the plan; every other option declines it.
   * Named rather than positional so no UI infers the verdict from option order.
   * An `approve` naming no option of its own question is rejected at `ask()`.
   */
  approve: string
}
```

## Conductor owner interaction

`ConductorOwnerIntent` binds exact run, question, revision, gate, role/attempt, required items and reason to a dedicated UI. An optional proposal previews the complete host-validated before/after mandate and its hash; models and localized labels cannot substitute those values.

`ConductorOwnerIntent.mode: continuation` identifies a read-only recovery card for an already durable answer. Its fresh transport binds the current answer revision and admits only `answer_continue` with empty answers and no proposal hash to consume the existing plan, without a new answer or budget charge.

`ConductorOwnerAnswer` uses machine actions and complete required answers. It replaces neither Gate C, GO nor closeout; the consumer validates and persists it through an exact host reservation before acknowledging transport.

```ts type-equiv
/** Exact normalized authority shown by the host; text answers cannot replace these fields. */
interface ConductorOwnerMandate {
  allowedPaths: string[]
  excludedPaths: string[]
  qualityCommandIds: string[]
}
```

```ts type-equiv
/** Host-projected Conductor owner interaction, separate from plan approval. */
interface ConductorOwnerIntent {
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
```

```ts type-equiv
/** Machine action and complete required answers; localized labels never grant authority. */
interface ConductorOwnerAnswer {
  questionId: string
  revision: number
  action: 'approve' | 'reject' | 'answer_continue'
  answers: { itemId: string; text: string; optionId?: string }[]
  proposalHash?: string
}
```

## Question item

`AskUserQuestionItem` is one question in a request. The caller supplies a stable `id`, which is echoed back with the answer so batched questions remain routable. Optional `detail` carries supporting text that providers render with the question but keep out of selectable option labels.

```ts type-equiv
/** One question in a user-questions request. */
interface AskUserQuestionItem {
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
```

## Ask request

`AskUserQuestionRequest` is the cross-package request. `questions` is an array so a UI can present related prompts in one flow while preserving a stable id per answer. When present, `agent` is the exact live caller; the interaction seam admits it only while the live registry identifies that instance as a runtime root. Optional `accept(answer)` is a durable consumer callback; the provider awaits it before acknowledging the response. Rejection keeps the question pending rather than reporting acceptance before persistence.

```ts type-equiv
/** Request for a human answer. */
interface AskUserQuestionRequest {
  /** Questions to display. */
  questions: AskUserQuestionItem[]
  /** Optional durable consumer acceptance, awaited by the transport before acknowledging the response. */
  accept?: (answer: AskUserQuestionAnswer) => Promise<void>
  /** Exact live calling agent, when the request came from an agent tool call. */
  agent?: Agent
  /** Abort signal for the owning tool/step. */
  signal?: AbortSignal
}
```

## Answer

Generic providers return one answer item per question id; a Conductor response instead uses `conductor` and an empty generic `answers` array. `selected` contains selected option labels, and `custom` carries a free-form "Other" answer when the user typed one. For a single-select question, `custom` overrides the selected choice and `selected` is empty. For a multi-select question, `custom` may supplement the labels in `selected`. A UI may also use an item with empty `selected` and no `custom` to preserve a skipped question in an otherwise completed batch.

```ts type-equiv
/** Answer to one question. */
interface AskUserQuestionAnswerItem {
  /** The answered question id. */
  id: string
  /** Selected option labels. May accompany custom text for a multi-select question. */
  selected: string[]
  /** Optional free-text "Other" answer. */
  custom?: string
}
```

```ts type-equiv
/** The human's answer. */
interface AskUserQuestionAnswer {
  /** Present only for the dedicated Conductor interaction; generic answers stay empty. */
  conductor?: ConductorOwnerAnswer
  /** Structured answers keyed by question id. */
  answers: AskUserQuestionAnswerItem[]
}
```

## Provider

Only one provider may be active in a context. Provider registration is effect-bound so HMR/disposal removes the active UI.

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## Errors

`UserQuestionError` extends `HarnessError`, so `ctx.tools.execute()` preserves `{ name, code }` for model-facing tool failures such as `EMPTY_QUESTIONS`, `NO_PROVIDER`, `ASK_ABORTED`, or UI-side cancellation.

```ts type-equiv
/** Stable error taxonomy for user-questions failures. */
class UserQuestionError extends HarnessError {
  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'UserQuestionError'
  }
}
```

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — this section is byte-identical in both language sides of the page. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxuserquestions--userquestionservice"></a>

### `ctx.userQuestions` — `UserQuestionService`

`ctx.userQuestions`: one active UI provider plus an `ask()` API.

```ts cordis-catalog
/**
 * Register the UI provider. Only one provider may be active in a context.
 *
 * @param provider UI-side implementation that collects answers.
 * @returns Disposer that unregisters this provider.
 */
registerProvider(provider: UserQuestionProvider): () => void

/**
 * Ask the active UI provider and wait for the user's answer.
 *
 * When a caller supplies an agent, human interaction is valid only for the
 * exact live runtime root. Runtime ownership, not durable session lineage,
 * decides this boundary: an owned child has no human answerer and would
 * block forever, while a lineage-bearing session resumed as a new runtime
 * root may ask normally.
 *
 * @param request Questions, owner agent, and abort signal.
 * @returns The answer chosen or typed by the human.
 * @throws {UserQuestionError} code `CALLER_NOT_LIVE` when a supplied
 *   agent is not the registry's exact live instance, or `DELEGATED_CALLER`
 *   when that live agent is owned by another agent.
 */
async ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
```

Source: [`packages/interaction/user-questions/src/index.ts:53`](../../packages/interaction/user-questions/src/index.ts)
<!-- END GENERATED cordis-surface -->
