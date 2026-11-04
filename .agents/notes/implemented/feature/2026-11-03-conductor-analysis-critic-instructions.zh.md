# Agent Note: 分离分析批评者指令

Status: implemented

[English](2026-11-03-conductor-analysis-critic-instructions.md) | 中文

## Problem

当前分析路由中，Devil's Advocate 负责生产报告。若把批评指令写入同一份 Markdown 正文，就会在批评路由存在之前改变生产者分派。缺失批评指令也必须在预设发布 agent 前被拒绝。

## Decision

正典 [Devil's Advocate 角色](../../../conductor/roles/03-devils-advocate.md)和[专家 skill](../../../skills/conductor-specialist/SKILL.md)通过 `metadata.analysisCritic` 携带 `dispatchMode: critic` 与非空 `instructions`。Markdown 正文仍是生产者指令。[预设加载器](../../../../packages/conductor/conductor-presets/README.md)在注册角色前拒绝缺失或无效批评元数据的任一必需 skill。内部类型化生产者分派使用既有 Markdown 正文和策略；类型化批评分派只选择这两项元数据指令。分析路由和 record 格式保持不变。

批评者挑战优先级、替代方案、遗漏风险，以及建议是否由已准入证据支持。Auditor 继续负责事实和引用核查。批评输入仅限最新候选报告及由 runtime 选择的已准入摘录；模型不选择摘录，也不重新探索仓库。`does_not_hold` 结果说明具体发现，并标注 scope、plan 或 report 错误类别。Intake 在分析运行前拒绝图片附件，因此批评者不会猜测其内容，也不会把所有者答复视为实施许可。[分析批评者设计](../../proposed/feature/2026-10-28-conductor-analysis-critic.md)规定最终的路由和结果语义。

内部批评分派使用既有的单子级 workflow 和全新 subagent provider。宿主在[构造经过哈希核验的提示词](../../../../packages/conductor/conductor/README.md)前预留真实子级 id，将其放入提示词专用的 identity 字段，并把 runtime 选出的摘录作为模型可见的子级输入记录。每次分派的输出上限包含 reasoning；不支持上限的 provider 会拒绝分派。子级没有文件或搜索工具。结构化返回值在任何门禁使用前，先经过 P1 的身份、语义和候选沿袭验证。现行 v4 路由从不选择此批评分支。

[官方 Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/)说明 `max_tokens` 耗尽时的 `finish_reason: length`，且 completion 用量包含 reasoning tokens（查阅于 2026-11-03）。真实 API 测试对 `deepseek-v4-flash` 和 `deepseek-v4-pro` 均发送 `max_tokens: 32`，检查 wire 终止原因，并验证上报的 completion tokens 包含 reasoning 且不超过上限。

## Alternatives considered

**将批评文字附加到角色正文。** 当前生产者会收到该正文，因此会在批评分派实现前改变既有分析行为。

**在路由启用前允许缺失元数据。** 这样会让指令不完整的安装启动，直到批评分派才失败，违背预设加载时明确报错的现有行为。

## Consequences

预设和分派分别验证生产者与批评者指令，同时保持当前生产者提示词、record 格式和路由不变。批评者完整的提示词与 persona 均记录在其子级会话中。真实 API 测试仅使用进程环境中的密钥，缺失密钥时跳过。
