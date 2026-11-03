# Agent Note: 一次性子智能体的预留身份与输出 token 上限

Status: implemented

[English](2026-11-02-reserved-child-identity-and-output-token-limit.md) | 中文

## 问题

宿主如果要把子智能体的身份写进其提示词，而提供方直到 `start()` 内才分配身份，就无法根据真实会话 id 构造提示词。一次性 subagent 与 workflow seam 也不能请求包含 reasoning 在内的累计输出 token 上限。提示词中的要求不能强制执行 token 上限。

## 决策

[subagent 一次性请求](../../../../docs/subsystems/subagent.md#the-one-shot-start-request)接受可选、由宿主预留的 `SessionId`。提供方只有能将该值用作真实子会话 id，才声明 `reservedSessionId` 能力。服务在启动前检查能力，并拒绝返回 id 不一致的运行。进程内 spawn 和 fork 提供方使用预留 id 创建子智能体；没有该选项时仍自行分配 id。未发布阶段的创建失败会回滚子智能体及其预留身份。

请求还接受可选的正安全整数 `maxOutputTokens`，限制子智能体累计输出，包含 reasoning。`outputTokenLimit` 表示提供方支持该能力。服务在启动前拒绝不支持的请求；提供方及其选定的模型适配器必须强制执行上限，不能静默忽略。循环把每次模型调用记录在日志中的 `maxTokens` 降至剩余累计额度，在重试或执行工具前计入提供方报告的 `outputTokens`（其中已包含 reasoning），并在用量缺失、无效或超限时失败。确切 LLM 路由必须声明 `enforcesMaxTokensIncludingReasoning`；`requireOutputTokenLimit` 要求此保证，但不会进入提供方 wire。`deepseek-official` 路由在官方 `https://api.deepseek.com` origin 可以声明此能力；自定义网关与 pi-ai 则不能。上限属于本次 dispatch，并非部署默认值。两项选项都缺席时，普通请求沿用原有组装和输出行为。

[DeepSeek Chat Completions API 文档](https://api-docs.deepseek.com/api/create-chat-completion/)（核对日期：2026-11-03）把 `max_tokens` 定义为生成 token 数，并在 `completion_tokens` 内的 `completion_tokens_details.reasoning_tokens` 报告推理 token。启用 thinking 的真实 API 测试验证报告的 completion token（包括 reasoning）不超过发送的上限。有效的工具调用响应耗尽最后的 token 时，循环先为每个未执行的调用记录合成错误结果，然后才结束该轮，使持久化历史可重放。

[workflow 启动请求](../../../../docs/subsystems/workflow.md#the-start-request)提供两个相互独立、仅限宿主的选项。`composeChildPrompt(sessionId, prompt)` 接收新预留的真实子智能体 id 及脚本提示词，返回发送给该子智能体的内容块。它在提供方启动前于宿主运行；回调不会进入 worker 脚本。已发布的子智能体 id 仍通过既有启动结果和生命周期事件传给 worker。回调抛错会拒绝该次子智能体启动，不会发布子智能体；脚本可以处理或继续传播该失败。`maxOutputTokensPerChild` 是传给本次运行中每次子智能体 dispatch 的正安全整数上限。引擎在创建运行前检查选定的 subagent 提供方是否具备所需能力。这两个选项都不暴露给模型编写的 workflow 脚本；选项缺席时，dispatch 行为不变。最终子智能体提示词在进入模型前记录于该子智能体的会话日志。

## 考虑过的替代方案

**猜测或事后修正子智能体 id。** 提示词中独立生成的标签或事后更正可能与实际创建的会话不一致。预留 id 并检查返回的运行，使模型可见的身份可以核实。

**要求模型遵守 token 预算。** 文本无法强制输出上限，尤其无法约束 reasoning token。因此宿主只向能够执行上限的提供方和模型适配器提出该请求。

**设置隐式的部署级上限。** 默认值会改变无关的委派行为，并且需要一个经过验证的 Config 字段。改由调用方为每次 dispatch 提供上限。

## 后果

宿主可以在发布前构造带真实身份的子智能体提示词，并约束单个子智能体生成的输出，而不改变普通委派。缺少任一能力的提供方会拒绝需要该能力的请求，因此消费方必须选择支持该能力的路由。workflow 宿主负责处理回调失败和子智能体清理；worker 只能看到原始脚本提示词和选项。测试覆盖预留身份、启动回滚、上限执行及不支持能力的提供方；未启用这些选项的路径保持 keyless snapshot 输出不变。
