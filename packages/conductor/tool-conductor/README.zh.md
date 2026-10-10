# @deepseek-ai/dsh-tool-conductor

[English](README.md) | 中文

面向模型的 Conductor 工具（`conductor`）。它接受一个目标以及可选的约束、验收标准、授权和恢复 id，然后铸造或恢复一次运行，并通过为每个阶段生成一个全新的结构化输出专家来驱动 Detective → Strategist → Devil's Advocate → Headsman → Auditor → Integrator → Arbiter 这一门控状态机。它返回 Arbiter 的 GO/NO-GO 决策或阻塞；GO 本身不会提交、推送、合并或部署。

状态机、gate 引擎和 Session 日志持久化位于 [`@deepseek-ai/dsh-conductor`](../conductor/README.md)；专家角色 skill 来自 [`@deepseek-ai/dsh-conductor-presets`](../conductor-presets/README.md)。每个 stage 都通过现有 workflow engine 运行一个单 agent workflow。Runtime 加载对应角色和 `conductor-specialist`，要求结构化输出，并在 child executor 中同时应用工具名称 allowlist 与参数感知 guard。Headsman 的 `allowed_paths`/`excluded_paths` 检查前会规范化写入目标；Integrator 还仅限 `docs` 与 `.agents/notes`。

`qualityCommands` 是默认空的部署 catalog。每个条目提供不透明 id、安全描述、精确 argv、允许的 stage、cwd、confinement mode 和资源限制。Gate C 把所选 id 与不可变 catalog hash 绑定进 execution baseline。私有 child 工具 `conductor_quality_check` 只接受一个 `command_id`；它不接受命令文本或额外参数，不通过 shell 调用绑定的 argv，要求 `SandboxEnforcement: full`，以有界方式收集输出且不创建 spill file，并只把执行事实和输出 digest 存入持久化的 `QualityExecutionRecord`。Headsman 及其 Ralph Round 可以生成 Gate-D record；全新的 Auditor 必须独立重跑 Gate-E binding。因此，所选 provider 除其他 child policy 外还必须支持可信 child tool contribution。

当 `maxRalphRounds` 为正时，Headsman 使用相同 child policy 调用共享 Ralph workflow runner，随后仍返回 ImplementationReport，进入 Gate D 和独立 Auditor review。Gate-G GO 以 `awaiting_authorization` 持久化；之后使用相同 `runId` 和明确 owner authorization 的调用，只记录已执行操作、outcome evidence、风险、follow-up 与 traceability。Conductor 本身不执行 release 操作。

## 已知限制与延期工作

- 所选 subagent provider 必须支持结构化输出、工具过滤、可信工具 guard、可信 child tool contribution 和逐 child persona；不支持的 provider 会在工具加载时明确失败。
- 当 host 没有完全强制执行的 sandbox backend 时，quality execution 会失败并保持关闭状态。Sandbox policy 只约束文件影响，不声称提供网络隔离。
- `workspace-write` 授予命令配置的 write root；启动受限进程所需的 backend 自有临时文件位于该产品 write root 之外。
- Closeout 仅记录结果。Commit、push、merge、publish 和 deploy 仍是由外部 owner 控制的操作。
