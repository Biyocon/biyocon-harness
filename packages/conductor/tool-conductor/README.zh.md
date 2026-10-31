# @deepseek-ai/dsh-tool-conductor

[English](README.md) | 中文

面向模型的 Conductor 工具（`conductor`）。它要求目标、purpose、A/B/C 入口及 mandate owner 归属信息；新运行还要求 intake 理由，分析在任何专家启动前要求 answer/recommendations 和至少一项可衡量的 `acceptanceCriteria`。约束描述限制，交付要求属于验收标准。其他输入包括引用材料 selector 和恢复 id。代码准入路线，为每个适用阶段生成全新结构化输出专家。模型不能授予写入、quality execution 或 closeout 权限。Gate C 验证精确 baseline 后，工具会通过 host approval seam 发起一次请求，其中包含 baseline hash、规范化绝对路径、所选 command binding 和必需 effect profile；拒绝、取消或无法审批都会在任何可写 child 或 quality child 启动前停止。它返回实现 GO/NO-GO、已审计分析报告或阻塞；GO 本身不会提交、推送、合并或部署。

状态机、gate 引擎和 Session 日志持久化位于 [`@deepseek-ai/dsh-conductor`](../conductor/README.md)；专家角色 skill 来自 [`@deepseek-ai/dsh-conductor-presets`](../conductor-presets/README.md)。每个 stage 都通过现有 workflow engine 运行一个单 agent workflow。Runtime 加载对应角色和 `conductor-specialist`，要求结构化输出，并在 child executor 中同时应用工具名称 allowlist 与参数感知 guard。Headsman 的 `allowed_paths`/`excluded_paths` 检查前会规范化写入目标；Integrator 还仅限 `docs` 与 `.agents/notes`。

`qualityCommands` 是默认空的部署 catalog。每个条目提供不透明 id、安全描述、精确 argv、允许的 stage、cwd、confinement mode 和资源限制。不可变 definition hash 包含文件系统 effect、强制 `network: deny` 和 `external: none`；Gate C 把所选 id 与 definition hash 绑定进 execution baseline。私有 child 工具 `conductor_quality_check` 只接受一个 `command_id`；它不接受命令文本或额外参数，只调用精确绑定的 argv，要求匹配的 host authorization，并要求 `SandboxEnforcement: full` 覆盖该具体文件系统与网络策略。它以有界方式收集输出且不创建 spill file，并只把执行事实和输出 digest 存入持久化的 `QualityExecutionRecord`。Headsman 及其 Ralph Round 可以生成 Gate-D record；全新的 Auditor 必须独立重跑 Gate-E binding。因此，所选 provider 除其他 child policy 外还必须支持可信 child tool contribution。

当 `maxRalphRounds` 为正时，Headsman 使用相同 child policy 调用共享 Ralph workflow runner。每个全新 Round 都会收到已批准的 execution baseline、验收标准、约束，以及已绑定的 Gate-D command id 和对应的模型安全描述，随后 Headsman 仍返回 ImplementationReport，进入 Gate D 和独立 Auditor review。Gate-G GO 以 `awaiting_authorization` 持久化。面向模型的工具不能关闭运行，也不能提供结构化 closeout authorization；host 可以稍后调用 core `closeRun` API，并提供明确 authorization 与 evidence。Conductor 本身不执行 release 操作。

`routeTasks` 默认为 `false`；随附的 Conductor 预设将其启用。对于父级的每项新任务，分派前只向模型提供 `conductor`，执行器守卫会拒绝其他调用，不受工作区指令影响。未分派就结束的轮次会明确报错。分派运行期间，以及返回任何结果之后（包括 Arbiter GO 或已报告分析），父级的所有工具和自动重新分派都被禁止；父级报告结果后停止。新的用户轮次或 steering（中途引导）消息重置路由，仅允许 `conductor`；仅有插件上下文不会重置。专家会话保留各阶段的策略。其他预设与通用指令 loader 不受影响。

第一个调用提出 `purpose: implementation | analysis`、`entry: detective | strategist | devils-advocate`、理由和来源 selector；分析另选 `deliverable: answer | recommendations`。`current-request` 标识实际用户消息。`materialFiles` 只包含该消息明确引用的规范化工作区相对文件；`scopeSources` 与 `planSources` 引用这些 selector，不接受模型虚构 ID。运行时通过文件系统服务捕获有界完整 UTF-8 输入和哈希，拒绝路径逃逸/替换，在分派前保存准入检查点，恢复重用捕获输入。`maxMaterialFiles` 默认 16，`maxMaterialBytes` 默认每输入 65536，`maxMaterialTotalBytes` 默认序列化准入 262144；均验证为正安全整数。

分析使用准入生产者 → Auditor → Arbiter；从 Detective 开始的建议由 Strategist 生成。分派包含不变的 `acceptance_criteria`、按原顺序逐字复制的指令，以及带有返工理由的 `gate_history`。候选标准不匹配时，返工给出完整预期列表及缺失、多余、变更的标准。子级过滤器与执行器守卫独立于提示词拒绝写入、shell、质量命令、批准和外部效果。Arbiter `accept | revise | blocked` 绑定精确候选/审计；接受终止为 `reported`，绝不是 GO 或宿主批准。修改要求新生产者版本及审计。实现保留执行 C 批准和质量/closeout 策略。[准入决策](../../../.agents/notes/implemented/feature/2026-10-25-conductor-intake-and-report-completion.md)规定路线与因果返工。

`maxReworkPerGate` 是经验证的正安全整数，默认值为 2；随附预设也设置为 2。报告格式和 baseline 提案错误在该门禁预算内重试同一角色，包括 Arbiter 报告修复。专家 schema 省略 `allowedPaths` 和 `excludedPaths`；运行时插入该运行的所有者路径和排除项，不扩大权限。专家编写路径属于报告错误，伪造宿主绑定或权限则立即停止。Workflow 或传输故障在保存已完成宿主质量记录的检查点后传播，不编造专家 envelope 或门禁决策。只有已完成但没有有效报告的工作才进入报告修复。

决策、报告和阻塞结果包含 `runId`、已达 `stage`、生命周期状态、含理由的完整 `gateHistory`，以及从运行时门禁尝试推导的 `specialistsRan`，包括被拒绝的报告。停放和所有者拒绝问题的结果保留原始升级原因；回答功能不可用的说明不使用实现阶段标签。运行创建前的错误明确说明没有启动 Conductor 运行；创建后的错误包含最后持久化运行状态及已确认启动但失败的子级，不编造门禁决策。这些诊断不将报告、受阻运行或 Arbiter GO 转变为执行权限。

每次工作流派发都在父日志中记录模型不可见的子会话身份与生命周期。运行时按该子会话派发时的历史偏移关联已保存的门禁，使每次返工独立保留。Ralph 的可信工作流观察器提供 worker 身份，但不把 Headsman 的 Gate D 赋予 worker。这些事件不影响提示、门禁决策或权限；[显示决策](../../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md)拥有其语义。

可恢复澄清、具体授权提案或耗尽的报告返工可在已 flush 的 v4 检查点中停放绑定精确子会话的所有者问题。身份、路由、baseline、证据、sandbox 违规与批准被拒仍为终止。`maxOwnerReassessmentsPerGate` 是正安全整数，默认和预设均为 2；计数独立于自动返工，重启不会重置。实现问题来自 `change_requests`；分析使用专用只读 `clarifications` 字段。Conductor 专属宿主控制器为精确的运行、问题、修订号和根会话绑定保留回答权限。仅显式 `conductorOwnerHostTest` 脚本化测试组合通过此入口提供回答；随附预设在 P3 前没有生产回答提供者，继续停放且不授予权限。不透明的插件收件箱消息开启无模型回答回合；回答文本、选项和授权变更绝不进入队列。限定作用域的 pre-step 钩子保存回答和检查点，等待 idle 与 flush 后，才安排一次受限的同运行继续执行。明确记录的插件上下文包含持久回答、有效授权及仍需获得的 Gate C 批准。复制消息文本或伪造来源不构成保留权限。即使 baseline 允许整个工作区，子会话写入校验也拒绝直接、嵌套及规范化别名路径中的 Git 元数据。等待期间父级路由拒绝普通工具，并在可见队列中保留新用户消息；只有私有宿主继续执行权限允许调用已存储的 conductor 运行。UI 保持不变。分派投影与校验器使用相同的持久台账及有效授权；授权变更仍要求新的执行 C 批准。升级后无法恢复现有格式 3 运行。重新连接为同一问题生成新的传输标识。相同重复回答返回已保存回执而不派发；失效、外来及冲突回答被拒绝。重启或取消会使未提交的队列标记失效，绝不自动继续。已持久化回答可以显式协调恢复；已消费但派发情况不明时继续停放。这不是跨进程锁；多写入者运行需要 [#51](https://github.com/Biyocon/biyocon-harness/issues/51)。

## 已知限制与延期工作

Skill 查找选择父 agent 的 scope key，因此其预设安装的角色和协议提供方不依赖任务工作区而保持可见。随附预设在挂载前验证这些资源；自定义组合必须提供完整的 skill catalog。

- 所选 subagent provider 必须支持结构化输出、工具过滤、可信工具 guard、可信 child tool contribution 和逐 child persona；不支持的 provider 会在工具加载时明确失败。
- 当 host 没有能够完整强制执行命令文件系统模式与网络拒绝的 sandbox backend 时，quality execution 会失败并保持关闭状态。
- `workspace-write` 授予命令配置的 write root；启动受限进程所需的 backend 自有临时文件位于该产品 write root 之外。
- Auditor 入口、verification 目的、dirty digest 和非 Git manifest 是不支持的第二阶段输入。
- Closeout 仅记录结果。Commit、push、merge、publish 和 deploy 仍是由外部 owner 控制的操作。
