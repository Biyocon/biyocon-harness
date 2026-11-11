# Agent Note: 与工具关联的提示词段

Status: implemented

[English](2026-11-11-tool-associated-prompt-sections.md) | 中文

## Problem

[#75 阶段 1](https://github.com/Biyocon/biyocon-harness/issues/75) 涉及子代理继承其有效工具视图已排除工具的指引。不可用的 `web_search` 指令构成明确的提示词冲突。仅移除 wire schema 不会移除独立注册的文本，而依据 wire schema 推导可见性，又会在 Code Mode 中错误隐藏经 SDK 可调用的能力。

## Decision

[PromptSection](../../../../packages/core/system-prompt/src/index.ts) 可声明 `requiresTools`。组装先解析作用域遮蔽，根据已注册能力全集验证全部前置条件，再仅在所有能力均可见时保留该段。提供的列表必须非空，名称唯一且非空白。无效引用在组装时失败；已知但被过滤的名称会在文本求值前抑制该段，包括 complete 段。未关联段保留既有行为。段名称不隐含工具语义。

工具提供方可通过 `ToolProviderResult.capabilities` 分别报告已知及可见能力名称；省略时从既有名称/schema 输入推导。[ToolRuntime](../../../../packages/core/tools/src/index.ts) 提供作用域查找视图，独立于 native/code/both wire 投影。因此 Code Mode 保留经 SDK 可调用工具的指引。每次组装均重新计算可见性，包括新建及恢复子代理。隐藏注册段在协作式 waterfall 后仍保持省略；监听器保留对未关联内容的控制权。关联元数据不是安全边界。

[Web 搜索](../../../../packages/web/tool-web/src/search.ts) 将基本指引关联至搜索，将独立抓取后续段关联至两个工具。[抓取](../../../../packages/web/tool-web/src/fetch.ts) 将指引关联至抓取，不再建议不可用搜索。提供方可用性不决定注册或可见性。执行限制及 Conductor 授权不变；核心不导入 Conductor 包。

结果系统提示词使用既有日志 request header。此决策仅部分取代[子代理组合](2026-07-12-subagent-persona-tool-filter-and-depth.md)中的独立指引规则；persona、深度、执行过滤及提供方要求继续有效。它实现[已批准验证设计](../../proposed/feature/2026-11-05-conductor-analysis-claim-verification.md)的通用部分，不改变 session/Conductor 格式，也不实现其主张分类、拒绝计数或证据模式。

## Alternatives considered

**解析 `tool:` 段名称前缀。** 拒绝，因为名称是身份，不是类型化能力声明，且一个段可能需要多个工具。

**修补 Conductor 子代理提示词。** 拒绝，因为继承不可用指引影响通用子代理组合，而且会将核心耦合至一个消费者。

**仅使用可见 wire schema。** 拒绝，因为纯 code 呈现会将可调用能力收束到 `run_code` 后方。

## Consequences

无效关联在最早可解析的组装时失败，不会静默丢弃拼写错误。受限作用域省略关联提示词 token，可能改变可复用前缀；未变化作用域保持确定性。其他工具插件显式选择关联。关联不会授予工具访问权，移除冲突指引也不保证模型绝不尝试不可用调用。

所属测试验证任意段名称、格式错误关联、隐藏提供方抑制、遮蔽、complete 段、Code Mode 及父/兄弟作用域隔离。真实 spawn/fork 子代理验证日志中的初始及冷恢复提示词。无密钥 ACP 示例通过实际 Loader 比较父/子提示词及 schema，使用公开合成回放材料和自有项目根目录。非受限子代理复用相同的父级 class pin；受限子代理拥有不同的 pin。两者均执行完整相等性比较及 fixture 清单检查。不引入私人数据或 GUI 代码；提供方请求仍由既有循环拥有。
