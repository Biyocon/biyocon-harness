# @deepseek-ai/dsh-tool-conductor

[English](README.md) | 中文

面向模型的 Conductor 工具（`conductor`）。它接受一个目标以及可选的约束、验收标准、mandate owner 归属信息和恢复 id，然后铸造或恢复一次运行，并通过为每个阶段生成一个全新的结构化输出专家来驱动 Detective → Strategist → Devil's Advocate → Headsman → Auditor → Integrator → Arbiter 这一门控状态机。模型不能授予写入、quality execution 或 closeout 权限。Gate C 验证精确 baseline 后，工具会通过 host approval seam 发起一次请求，其中包含 baseline hash、规范化绝对路径、所选 command binding 和必需 effect profile；拒绝、取消或无法审批都会在任何可写 child 或 quality child 启动前停止。它返回 Arbiter 的 GO/NO-GO 决策或阻塞；GO 本身不会提交、推送、合并或部署。

状态机、gate 引擎和 Session 日志持久化位于 [`@deepseek-ai/dsh-conductor`](../conductor/README.md)；专家角色 skill 来自 [`@deepseek-ai/dsh-conductor-presets`](../conductor-presets/README.md)。每个 stage 都通过现有 workflow engine 运行一个单 agent workflow。Runtime 加载对应角色和 `conductor-specialist`，要求结构化输出，并在 child executor 中同时应用工具名称 allowlist 与参数感知 guard。Headsman 的 `allowed_paths`/`excluded_paths` 检查前会规范化写入目标；Integrator 还仅限 `docs` 与 `.agents/notes`。

`qualityCommands` 是默认空的部署 catalog。每个条目提供不透明 id、安全描述、精确 argv、允许的 stage、cwd、confinement mode 和资源限制。不可变 definition hash 包含文件系统 effect、强制 `network: deny` 和 `external: none`；Gate C 把所选 id 与 definition hash 绑定进 execution baseline。私有 child 工具 `conductor_quality_check` 只接受一个 `command_id`；它不接受命令文本或额外参数，只调用精确绑定的 argv，要求匹配的 host authorization，并要求 `SandboxEnforcement: full` 覆盖该具体文件系统与网络策略。它以有界方式收集输出且不创建 spill file，并只把执行事实和输出 digest 存入持久化的 `QualityExecutionRecord`。Headsman 及其 Ralph Round 可以生成 Gate-D record；全新的 Auditor 必须独立重跑 Gate-E binding。因此，所选 provider 除其他 child policy 外还必须支持可信 child tool contribution。

当 `maxRalphRounds` 为正时，Headsman 使用相同 child policy 调用共享 Ralph workflow runner。每个全新 Round 都会收到已批准的 execution baseline、验收标准、约束，以及已绑定的 Gate-D command id 和对应的模型安全描述，随后 Headsman 仍返回 ImplementationReport，进入 Gate D 和独立 Auditor review。Gate-G GO 以 `awaiting_authorization` 持久化。面向模型的工具不能关闭运行，也不能提供结构化 closeout authorization；host 可以稍后调用 core `closeRun` API，并提供明确 authorization 与 evidence。Conductor 本身不执行 release 操作。

## 已知限制与延期工作

Skill 查找选择父 agent 的 scope key，因此其预设安装的角色和协议提供方不依赖任务工作区而保持可见。随附预设在挂载前验证这些资源；自定义组合必须提供完整的 skill catalog。

- 所选 subagent provider 必须支持结构化输出、工具过滤、可信工具 guard、可信 child tool contribution 和逐 child persona；不支持的 provider 会在工具加载时明确失败。
- 当 host 没有能够完整强制执行命令文件系统模式与网络拒绝的 sandbox backend 时，quality execution 会失败并保持关闭状态。
- `workspace-write` 授予命令配置的 write root；启动受限进程所需的 backend 自有临时文件位于该产品 write root 之外。
- Closeout 仅记录结果。Commit、push、merge、publish 和 deploy 仍是由外部 owner 控制的操作。
