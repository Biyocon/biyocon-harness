# @deepseek-ai/dsh-tool-conductor

[English](README.md) | 中文

面向模型的 Conductor 工具（`conductor`）。它要求目标、purpose、A/B/C 入口及 mandate owner 归属信息；新运行还要求 intake 理由，分析在任何专家启动前要求 answer/recommendations 和至少一项可衡量的 `acceptanceCriteria`。约束描述限制，交付要求属于验收标准。其他输入包括引用材料 selector 和恢复 id。代码准入路线，为每个适用阶段生成全新结构化输出专家。模型不能授予写入、quality execution 或 closeout 权限。Gate C 验证精确 baseline 后，工具会通过 host approval seam 发起一次请求，其中包含 baseline hash、规范化绝对路径、所选 command binding 和必需 effect profile；拒绝、取消或无法审批都会在任何可写 child 或 quality child 启动前停止。它返回实现 GO/NO-GO、已审计分析报告或阻塞；GO 本身不会提交、推送、合并或部署。

状态机、gate 引擎和 Session 日志持久化位于 [`@deepseek-ai/dsh-conductor`](../conductor/README.md)；专家角色 skill 来自 [`@deepseek-ai/dsh-conductor-presets`](../conductor-presets/README.md)。每个 stage 都通过现有 workflow engine 运行一个单 agent workflow。Runtime 加载对应角色和 `conductor-specialist`，要求结构化输出，并在 child executor 中同时应用工具名称 allowlist 与参数感知 guard。Headsman 的 `allowed_paths`/`excluded_paths` 检查前会规范化写入目标；Integrator 还仅限 `docs` 与 `.agents/notes`。

`qualityCommands` 是默认空的部署 catalog。每个条目提供不透明 id、安全描述、精确 argv、允许的 stage、cwd、confinement mode 和资源限制。不可变 definition hash 包含文件系统 effect、强制 `network: deny` 和 `external: none`；Gate C 把所选 id 与 definition hash 绑定进 execution baseline。私有 child 工具 `conductor_quality_check` 只接受一个 `command_id`；它不接受命令文本或额外参数，只调用精确绑定的 argv，要求匹配的 host authorization，并要求 `SandboxEnforcement: full` 覆盖该具体文件系统与网络策略。它以有界方式收集输出且不创建 spill file，并只把执行事实和输出 digest 存入持久化的 `QualityExecutionRecord`。Headsman 及其 Ralph Round 可以生成 Gate-D record；全新的 Auditor 必须独立重跑 Gate-E binding。因此，所选 provider 除其他 child policy 外还必须支持可信 child tool contribution。

当 `maxRalphRounds` 为正时，Headsman 使用相同 child policy 调用共享 Ralph workflow runner。每个全新 Round 都会收到已批准的 execution baseline、验收标准、约束，以及已绑定的 Gate-D command id 和对应的模型安全描述，随后 Headsman 仍返回 ImplementationReport，进入 Gate D 和独立 Auditor review。Gate-G GO 以 `awaiting_authorization` 持久化。面向模型的工具不能关闭运行，也不能提供结构化 closeout authorization；host 可以稍后调用 core `closeRun` API，并提供明确 authorization 与 evidence。Conductor 本身不执行 release 操作。

`routeTasks` 默认为 `false`；随附的 Conductor 预设将其启用。对于父级的每项新任务，分派前只向模型提供 `conductor`，执行器守卫会拒绝其他调用，不受工作区指令影响。未分派就结束的轮次会明确报错。分派运行期间，以及返回任何结果之后（包括 Arbiter GO 或已报告分析），父级的所有工具和自动重新分派都被禁止；父级报告结果后停止。没有待处理所有者交互时，新的用户轮次或 steering（中途引导）消息重置路由，仅允许 `conductor`；仅有插件上下文不会重置。待答所有者问题则将到达的用户任务保留在可见队列。专家会话保留各阶段的策略。其他预设与通用指令 loader 不受影响。

第一个调用提出 `purpose: implementation | analysis`、`entry: detective | strategist | devils-advocate`、理由和来源 selector；分析另选 `deliverable: answer | recommendations`。`current-request` 标识实际用户消息。`materialFiles` 只包含该消息明确引用的规范化工作区相对文件；`scopeSources` 与 `planSources` 引用这些 selector，不接受模型虚构 ID。运行时通过文件系统服务捕获有界完整 UTF-8 输入和哈希，拒绝路径逃逸/替换，在分派前保存准入检查点，恢复重用捕获输入。`maxMaterialFiles` 默认 16，`maxMaterialBytes` 默认每输入 65536，`maxMaterialTotalBytes` 默认序列化准入 262144；均验证为正安全整数。

分析按已准入生产者 → Devil's Advocate 批评者 → Auditor → Arbiter 运行。Detective 入口的 recommendations 由 Strategist 生产；其他交付物由已准入入口角色生产，Devil's Advocate 入口使用不同的生产者与批评者子会话。生产者收到不变的 `acceptance_criteria` 和 `gate_history`；候选标准不匹配时，返工给出精确的缺失、多余和变更项目。批评者根据宿主选取且已记录的材料摘录质疑推理；Auditor 核查事实与引用。每个新候选在审计前都需要新的 `holds` 批评；Arbiter `accept | revise | blocked` 绑定精确的候选、批评及审计哈希。格式错误的批评在 Gate C 重试批评者，不重新运行生产者；有效的 `does_not_hold` 按类型化 scope、plan 或 report 错误类别路由。子会话过滤器和执行器守卫拒绝写入、shell、质量命令、批准及外部效果。接受终止为 `reported`，绝不是 GO 或宿主批准。实现保留执行 C 批准及质量/closeout 策略。[批评者启用决策](../../../.agents/notes/implemented/feature/2026-10-28-conductor-analysis-critic.md)解释路线及证据绑定。

类型化分析子级分派通过 workflow 引擎预留真实子会话 id，从经过哈希核验的已准入材料行区间构造候选绑定提示词，选择 `analysisCritic` 元数据而非生产者正文，并对每个子会话应用包含 reasoning 的输出上限。批评者没有文件或搜索工具；结构化输出通过 `AnalysisChallenge` 验证后才能用于 Gate C。`maxCriticInputTokensPerAttempt` 默认 24000、`maxCriticOutputTokensPerAttempt` 默认 16000、`maxCriticTokensPerRun` 默认 120000。三者均验证为正安全整数，运行总上限至少等于两个逐次上限之和。派发前的输入检查使用 token meter 固定的每 token 四字符文本密度，估算完整批评提示词、角色指令和输出 schema 的 token 数；派发后以服务商报告的实际用量为准。宿主在准入时保存三个上限，在派发前预留完整一次尝试，记录服务商报告的输入和包含推理的输出用量，并在用量缺失或超限时阻塞。缺失用量按完整预留额度计费；运行预算耗尽时给出已消耗、预留和上限的准确数值并终止，不提出所有者问题。无法强制执行含推理输出上限的服务商会被拒绝。[批评者指令决策](../../../.agents/notes/implemented/feature/2026-11-03-conductor-analysis-critic-instructions.md)解释生产者与批评者提示词的分离。

`maxReworkPerGate` 是经验证的正安全整数，默认值为 2；随附预设也设置为 2。报告格式和 baseline 提案错误在该门禁预算内重试同一角色，包括 Arbiter 报告修复。实质性批评耗尽预算时停放所有者问题；`answer_continue` 按已验证的类型化缺陷目标继续，生成新候选并重新批评，不重置 Gate C 的自动返工计数。专家 schema 省略 `allowedPaths` 和 `excludedPaths`；运行时插入该运行的所有者路径和排除项，不扩大权限。专家编写路径属于报告错误，伪造宿主绑定或权限则立即停止。其他 Workflow 或传输故障在保存已完成宿主质量记录的检查点后传播，不编造专家 envelope 或门禁决策。批评者子会话已启动后失败则将已知子会话、尝试编号及用量作为终止性 Gate C 权限阻塞保存检查点；创建子会话前启动失败不记录尝试。只有已完成但没有有效报告的工作才进入报告修复。

决策、报告和阻塞结果包含 `runId`、已达 `stage`、生命周期状态、含理由的完整 `gateHistory`，以及从运行时门禁尝试推导的 `specialistsRan`，包括被拒绝的报告。停放和所有者拒绝问题的结果保留原始升级原因；回答功能不可用的说明不使用实现阶段标签。运行创建前的错误明确说明没有启动 Conductor 运行；创建后的错误包含最后持久化运行状态及已确认启动但失败的子级，不编造门禁决策。这些诊断不将报告、受阻运行或 Arbiter GO 转变为执行权限。

每次工作流派发都在父日志中记录模型不可见的子会话身份与生命周期。运行时按该子会话派发时的历史偏移关联已保存的门禁，使每次返工独立保留。Ralph 的可信工作流观察器提供 worker 身份，但不把 Headsman 的 Gate D 赋予 worker。这些事件不影响提示、门禁决策或权限；[显示决策](../../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md)拥有其语义。

可恢复澄清、具体授权提案或耗尽的报告返工可在已 flush 的 v5 检查点中停放绑定精确子会话的所有者问题。身份、路由、baseline、证据、sandbox 违规与批准被拒仍为终止。`maxOwnerReassessmentsPerGate` 是正安全整数，默认和预设均为 2；计数独立于自动返工，重启不会重置。实现问题来自 `change_requests`；分析使用专用只读 `clarifications` 字段。Conductor 专属宿主控制器为精确的运行、问题、修订号和根会话绑定保留回答权限。回答提交后先结束当前问题，再允许继续执行提出下一个问题；旧提供者的生命周期仍受管理，直到其清理完成。`ownerQuestions` 默认为 `false`；随附预设启用它，通过用户问题服务及本控制器收集生产回答。没有可用问题提供者时，运行保持停放且不授予权限。显式 `conductorOwnerHostTest` 仅在测试组合提供脚本化回答。不透明的插件收件箱消息开启无模型回答回合；回答文本、选项和授权变更绝不进入队列。限定作用域的 pre-step 钩子保存并 flush 回答检查点，在同一宿主回合内追加必读 `conductor/owner-response-acknowledged` 证明，然后等待 idle 与最终 flush，才安排一次受限的同运行继续执行。没有该证明时，卡片绝不把原始推送的回答/拒绝事件视为持久回执。明确记录的插件上下文包含持久回答、有效授权及仍需获得的 Gate C 批准。复制消息文本或伪造来源不构成保留权限。即使 baseline 允许整个工作区，子会话写入校验也拒绝直接、嵌套及规范化别名路径中的 Git 元数据。等待期间父级路由拒绝普通工具，并在可见队列中保留新用户消息；只有私有宿主继续执行权限允许调用已存储的 conductor 运行。类型化 `conductor-owner` 卡片显示精确运行、门禁、角色/尝试、原因、必答条目及路径/命令变更前后提案。机器操作 `approve`、`reject` 与 `answer_continue` 独立于英/丹标签。批准要求具体提案；所有非拒绝回答都要求全部答案及明确确认授权变更。持久所有者事件在浏览器刷新后保留等待/接受/拒绝历史。[所有者交互决策](../../../.agents/notes/implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md)拥有完整安全与恢复理由。分派投影与校验器使用相同的持久台账及有效授权；授权变更仍要求新的执行 C 批准。升级后无法恢复现有格式 4 运行。重新连接为同一问题生成新的传输标识。相同重复回答返回已保存回执而不派发；失效、外来及冲突回答被拒绝。已记录答案的宿主回合或确认 flush 失败时，显式重新提交相同回答会在宿主专属回合修复并 flush 缺失回执。控制器仅结束精确匹配的失败交互，并为未消费的已接受计划提供新的只读继续卡片，不重复记录回答或扣减重新评估额度；派发要求另一次显式继续操作。之后的重复回答只返回已保存回执。重启或取消会使未提交的队列标记失效，绝不自动继续。已持久化回答可以显式协调恢复。重启后，已接受但未消费的答案获得确认及只读继续卡片，绝不自动派发。唯一的 `answer_continue` 不携带已修改答案或授权变更，验证新的精确运行/问题/修订号/根传输，并通过 `resumePending` 继续，不再次记录台账回答或扣减预算。已消费但派发情况不明时继续停放。这不是跨进程锁；多写入者运行需要 [#51](https://github.com/Biyocon/biyocon-harness/issues/51)。

## Detective 搜索分页

仅 Detective 接收作用域内的 `glob`/`grep` 分页。`detectiveGlobMaxResultChars` 和 `detectiveGrepMaxResultChars` 默认将完整结果限制为 4000 个 Unicode 字符，包含计数、摘要和下一页游标。上限必须是安全整数，并能容纳元数据。续页只提供 `cursor`；新搜索提供 `pattern`、可选的 `path`，以及仅 grep 支持的 `include`。未返回条目不计为已检查；被裁剪的 grep 行需要通过 `read` 获取上下文。其他角色保留继承的定义。

`detectiveSearch` 独立配置条目、行预览、原始输出和进程限制，数值默认值沿用搜索工具；`sampleOverCapGlobResults` 默认为 true。`detectiveSearchSnapshotRoot` 默认位于 DSH_HOME 下的 `storages/conductor-search`，显式配置时必须是绝对路径。`detectiveSearchSnapshotMaxBytes` 默认为 40000000 序列化字节。私有文件绑定到 run/子 agent。续页校验保存的结果，而不读取变化后的文件；文件缺失或无效时明确失败。冷启动续页需保留此目录；不会自动清理。参见[决策](../../../.agents/notes/implemented/feature/2026-11-11-detective-search-pages.md)。

## 已知限制与延期工作

Skill 查找选择父 agent 的 scope key，因此其预设安装的角色和协议提供方不依赖任务工作区而保持可见。随附预设在挂载前验证这些资源；自定义组合必须提供完整的 skill catalog。

- 所选 subagent provider 必须支持结构化输出、工具过滤、可信工具 guard、可信 child tool contribution 和逐 child persona；不支持的 provider 会在工具加载时明确失败。
- 当 host 没有能够完整强制执行命令文件系统模式与网络拒绝的 sandbox backend 时，quality execution 会失败并保持关闭状态。
- `workspace-write` 授予命令配置的 write root；启动受限进程所需的 backend 自有临时文件位于该产品 write root 之外。
- Auditor 入口、verification 目的、dirty digest 和非 Git manifest 是不支持的第二阶段输入。
- Closeout 仅记录结果。Commit、push、merge、publish 和 deploy 仍是由外部 owner 控制的操作。
