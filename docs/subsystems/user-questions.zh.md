# 用户交互

[English](user-questions.md) | 中文

[dsh-user-questions](../../packages/interaction/user-questions) 的用户交互 seam。它是工具或权限插件需要人类回答后 agent（智能体）才能继续时所使用的、提供方无关的词汇。UI 界面提供活跃的 `UserQuestionProvider`；host 运行时把请求转发给其连接的客户端。

源码：[`packages/interaction/user-questions/src/index.ts`](../../packages/interaction/user-questions/src/index.ts)

## 问题选项

`AskUserQuestionOption` 包含一个可供选择的选项。`label` 是面向用户的选项文字，同时也是面向模型的选中值；`description` 是可选的 UI 帮助文本。

```ts type-equiv
/** One selectable answer offered to the user. */
interface AskUserQuestionOption {
  /** User-facing label. */
  label: string
  /** Optional extra context rendered by capable UIs. */
  description?: string
}
```

## 呈现意图

`AskUserQuestionIntent` 区分计划审阅与类型化 Conductor 所有者交互。对于 `plan-review`，`approve` 指名肯定选项而不依赖顺序；匹配选项不存在或缺少 `detail` 时，`ask()` 拒绝。`conductor-owner` 携带下述专用机器动作协议，不复用计划选项标签。

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

## Conductor 所有者交互

`ConductorOwnerIntent` 将精确运行、问题、修订号、门禁、角色/尝试、必答项与原因绑定至专用 UI。可选提案展示宿主验证的完整授权变更前后值及哈希；模型或翻译标签不能替换这些值。

`ConductorOwnerIntent.mode: continuation` 表示已有持久回答的只读恢复卡片。其新传输绑定当前答案修订号，仅允许空答案且无提案哈希的 `answer_continue` 消费现有计划，不新增回答或预算扣减。

`ConductorOwnerAnswer` 使用机器操作和完整必答答案。它不能代替 Gate C、GO 或 closeout；消费方在确认传输回执前通过精确宿主预留验证并持久化答案。

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

## 问题条目

`AskUserQuestionItem` 是请求中的一个问题。调用方提供稳定的 `id`，它会随答案原样返回，使批量问题仍可路由。可选的 `detail` 携带辅助文本；提供方会将其随问题渲染，但不会放入可选选项标签。

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

## 提问请求

`AskUserQuestionRequest` 是跨包请求。`questions` 是数组，这样 UI 可以在一个流程中呈现相关提示，同时保持每个回答有稳定的 id。如提供 `agent`，它必须与存活调用方是同一实例；只有当当前注册表将该实例识别为运行时根时，交互 seam 才会接纳该 agent。可选 `accept(answer)` 是持久化消费方回调；提供方在确认回答前等待它。拒绝时问题保持待答，不会在持久化前报告接受。

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

## 回答

通用提供方为每个问题 id 返回一个回答项；Conductor 回答则使用 `conductor`，并将通用 `answers` 数组置空。`selected` 包含选中的选项标签，`custom` 在用户输入自由文本时携带「其他」回答。对于单选题，`custom` 会覆盖选中的选项，且 `selected` 为空。对于多选题，`custom` 可以补充 `selected` 中的标签。UI 也可以使用 `selected` 为空且不含 `custom` 的回答项，在其余问题均已完成的批次中保留被跳过的问题。

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

## 提供方

同一上下文中只能有一个活跃的提供方。提供方注册绑定到 effect，因此 HMR（热模块替换）或 dispose（资源释放）会移除当前活跃的 UI。

```ts type-equiv
/** UI-side provider for user questions. */
interface UserQuestionProvider {
  ask(request: AskUserQuestionRequest): Promise<AskUserQuestionAnswer>
}
```

## 错误

`UserQuestionError` 继承 `HarnessError`，因此 `ctx.tools.execute()` 会保留 `{ name, code }`，用于面向模型的工具失败，如 `EMPTY_QUESTIONS`、`NO_PROVIDER`、`ASK_ABORTED` 或 UI 侧取消。

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
