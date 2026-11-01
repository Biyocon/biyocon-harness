# @deepseek-ai/dsh-user-questions

English | [中文](README.zh.md)

User-interaction Service Definition. It owns `ctx.userQuestions`, the service a model-facing tool or permission plugin uses when it needs to pause work and ask the human for a decision.

## Service: `UserQuestionService` (ctx key: `userQuestions`)

### Public API

- `ctx.userQuestions.registerProvider(provider): () => void` Register the UI-side provider. Only one provider may be active in a context; disposal unregisters it.
- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` Ask the active provider and wait for the answer.

### Key Types

- `AskUserQuestionRequest` — `{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }], agent?, signal?, accept? }`; `detail` supplies supporting text that providers render with the question without turning it into an option label. When present, `agent` must be the registry's exact live runtime root.
- `AskUserQuestionOption` — `{ label, description? }`.
- `AskUserQuestionIntent` — tagged `plan-review` or `conductor-owner`; the former names an approval option, while the latter carries exact owner-question provenance and proposal data.
- `AskUserQuestionAnswer` — `{ answers: [{ id, selected, custom? }], conductor? }`; the dedicated Conductor response keeps generic answers empty and carries question ID, revision, machine action, complete required answers and optional proposal hash.
- `UserQuestionProvider` — UI implementation with `ask(request)`.
- `UserQuestionError` — `HarnessError` subclass with codes such as `EMPTY_QUESTIONS`, `BAD_INTENT`, `NO_PROVIDER`, `DUPLICATE_PROVIDER`, `ASK_ABORTED`, `CALLER_NOT_LIVE`, and `DELEGATED_CALLER`.

For a single-select question, `custom` overrides the selected choice and `selected` is empty. For a multi-select question, `custom` may supplement the labels in `selected`. A UI may preserve a skipped item as `{ id, selected: [] }`, keeping the existing answer shape while retaining other answers in the batch.

When a request carries an agent, `ask()` authenticates its exact identity through the live `AgentRegistry` and admits only a runtime root. Durable lineage is not authority: a session with historical delegation depth may ask after it is resumed as a new runtime root, while a live child owned by another agent is rejected even if its durable depth is zero. Agentless programmatic requests retain the existing provider path.

### Presentation intent

`intent` declares that a question IS a known kind of decision, so a UI that recognises the tag may present it as such — `plan-review` says `detail` is a plan under review, and `dsh-plan-mode` sets it on the `exit_plan_mode` question. An intent changes presentation only: a UI honouring it answers with the same option labels a generic UI would send, and a UI that does not know the tag renders the generic option list, so callers read the same answer fields either way. `approve` names the label that approves rather than relying on option order. `ask()` rejects with `BAD_INTENT` the two assertions no type can carry: an `approve` naming none of that question's own options, and an intent on a question with no `detail` — the thing it declares itself a review of.

`conductor-owner` is a typed owner interaction rather than plan-review option-label approval. Its host-projected metadata includes run/question identity, revision, gate, role/attempt, reason, mandatory items, and an optional exact before/after mandate with proposal hash. `ConductorOwnerAnswer` uses `approve | reject | answer_continue`, complete item answers and explicit proposal confirmation; localized labels do not choose the action. Conductor's controller validates the exact live session and current durable question, so an intent alone grants no authority. `mode: continuation` presents an already accepted, unconsumed answer read-only; only `answer_continue` with empty answers and no proposal hash may consume its existing host-bound plan, without another answer or budget charge.

`accept(answer)` lets a durable consumer validate and commit a response before its transport acknowledges it. The web provider awaits this callback; a failed callback rejects the receipt and retains the pending question. Conductor uses it for the model-free answer turn and flush barrier described in the [owner-interaction decision](../../../.agents/notes/implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md). The controller also records a required post-flush acknowledgement inside its host turn; the UI requires that matching marker before presenting accepted/rejected history. A transport cancellation or closed dialog is never an owner approval.

## Role

This is the Service Definition package. Consumers such as `@deepseek-ai/dsh-tool-ask-user` depend on this service; the Web host runtime supplies the shipped Service Provider. The loop stays unchanged: a tool call awaits a promise, and the tool result resumes the normal agent loop.

## Model Experience

Indirectly, through `dsh-tool-ask-user`, which retains a successful provider answer as compact JSON or one of these failures: `Error: ask_user_question was aborted before the user answered`, `Error: ask_user_question requires at least one question`, `Error: human interaction requires the exact live calling agent when an agent is supplied`, `Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result`, `Error: no user-questions provider is registered`, or `Error: <message>`. Waiting for the human adds no tokens.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **One provider per context** — there is no routing or fan-out to multiple UIs; a second registration throws `DUPLICATE_PROVIDER`, and with none registered `ask()` throws `NO_PROVIDER` rather than degrading.
- **Only declared interaction types are supported** — generic questions, plan review and Conductor owner questions have typed forms; file pickers and unrelated richer interactions remain outside this service.
