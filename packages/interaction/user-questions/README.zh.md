# @deepseek-ai/dsh-user-questions

[English](README.md) | 中文

用户交互 Service Definition。它定义 `ctx.userQuestions`，供面向模型的工具或权限插件在需要暂停工作并询问人类决定时使用。

## 服务：`UserQuestionService`（ctx 键：`userQuestions`）

### 公开 API

- `ctx.userQuestions.registerProvider(provider): () => void` 注册 UI 侧提供方。同一上下文中只能有一个活跃提供方；dispose（资源释放）会将其注销。
- `ctx.userQuestions.ask(request): Promise<AskUserQuestionAnswer>` 向活跃提供方提问并等待回答。

### 关键类型

- `AskUserQuestionRequest`：`{ questions: [{ id, question, detail?, header?, options?, multiSelect?, intent? }], agent?, signal?, accept? }`；`detail` 提供辅助文本，提供方会将其随问题一起渲染，而不会将其变成选项标签。如提供 `agent`，它必须与注册表中的存活运行时根 agent（智能体）是同一对象。
- `AskUserQuestionOption`：`{ label, description? }`。
- `AskUserQuestionIntent`：带标签的 `plan-review` 或 `conductor-owner`；前者指名批准选项，后者携带精确所有者问题来源及提案数据。
- `AskUserQuestionAnswer`：`{ answers: [{ id, selected, custom? }], conductor? }`；专用 Conductor 回答将通用答案置空，并携带问题 ID、修订号、机器操作、完整必答答案及可选提案哈希。
- `UserQuestionProvider`：包含 `ask(request)` 的 UI 实现。
- `UserQuestionError`：`HarnessError` 的子类，包含 `EMPTY_QUESTIONS`、`BAD_INTENT`、`NO_PROVIDER`、`DUPLICATE_PROVIDER`、`ASK_ABORTED`、`CALLER_NOT_LIVE` 和 `DELEGATED_CALLER` 等代码。

对于单选题，`custom` 会覆盖选中的选项，且 `selected` 为空。对于多选题，`custom` 可以补充 `selected` 中的标签。UI 可以把跳过的条目保留为 `{ id, selected: [] }`，既维持现有回答形态，也保留该批次中的其他回答。

请求包含 agent 时，`ask()` 会通过当前 `AgentRegistry` 验证该 agent 与注册表中的存活实例是同一对象，并且只允许运行时根调用。持久谱系不构成权限依据：带有历史委托深度的会话恢复为新的运行时根后可以提问；归属于另一个 agent 的存活子级即使持久化记录的委托深度为零也会被拒绝。不含 agent 的程序化请求继续沿用现有提供方路径。

### 呈现意图

`intent` 声明某个问题本身就是一种已知决策，因此认识该标签的 UI 可以照此呈现——`plan-review` 表示 `detail` 是一份待审阅的计划，`dsh-plan-mode` 会在 `exit_plan_mode` 的问题上设置它。意图只改变呈现：遵循它的 UI 回答的仍是通用 UI 会发送的那些选项标签，不认识该标签的 UI 渲染通用选项列表，因此调用方两种情况下读到的回答字段相同。`approve` 指名表示批准的标签，而不依赖选项顺序。有两项断言无法通过类型表达，`ask()` 会以 `BAD_INTENT` 拒绝它们：`approve` 未命中该问题自身的任一选项，以及意图落在没有 `detail` 的问题上——而 `detail` 正是它自称在审阅的东西。

`conductor-owner` 是类型化所有者交互，不是计划审阅的选项标签批准。宿主投影数据包含运行/问题身份、修订号、门禁、角色/尝试、原因、必答项，以及可选的精确变更前后授权及提案哈希。`ConductorOwnerAnswer` 使用 `approve | reject | answer_continue`、完整条目答案和明确提案确认；本地化标签不选择动作。Conductor 控制器验证精确活动会话及当前持久化问题，因此单独一个意图不授予权限。`mode: continuation` 只读展示已接受但未消费的答案；仅允许空答案且无提案哈希的 `answer_continue` 消费现有宿主绑定计划，不重复记录回答或扣减预算。

`accept(answer)` 允许持久化消费方在传输确认前验证并提交回答。Web 提供者等待该回调；回调失败会拒绝回执并保留待答问题。Conductor 将其用于[所有者交互决策](../../../.agents/notes/implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md)中定义的无模型回答回合及 flush 屏障。控制器还在宿主回合内记录必读的 flush 后确认；UI 在展示接受/拒绝历史前要求该匹配标记。传输取消或关闭对话框绝不构成所有者批准。

## 职责

这是 Service Definition 包。`@deepseek-ai/dsh-tool-ask-user` 等 Consumer 依赖此服务；Web 宿主运行时提供随产品交付的 Service Provider。循环保持不变：工具调用等待 Promise，工具结果随后恢复正常的 agent loop（智能体循环）。

## 模型体验

间接地，通过 `dsh-tool-ask-user`：它会将成功的提供方回答保留为紧凑 JSON，或返回以下失败之一：`Error: ask_user_question was aborted before the user answered`、`Error: ask_user_question requires at least one question`、`Error: human interaction requires the exact live calling agent when an agent is supplied`、`Error: human interaction is unavailable while the calling agent is owned by another live agent; include the unresolved question or decision in the child agent's final result`、`Error: no user-questions provider is registered` 或 `Error: <message>`。等待人类回答不会增加 token。

#### KV Cache 影响

不会直接使 KV Cache 失效；请求前缀的任何变更均由上述消费方负责。

## 已知限制与暂缓事项

- **每个上下文只能有一个提供方**：不支持路由或扇出到多个 UI；第二次注册会抛出 `DUPLICATE_PROVIDER`，未注册任何提供方时，`ask()` 会抛出 `NO_PROVIDER`，而不会降级。
- **仅支持已声明交互类型**：通用问题、计划审阅和 Conductor 所有者问题具有类型化表单；文件选择器及无关复杂交互仍不属于本服务。
