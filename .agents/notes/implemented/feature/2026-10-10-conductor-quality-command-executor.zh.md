# Agent Note: Conductor quality-command executor

Status: implemented

[English](2026-10-10-conductor-quality-command-executor.md) | 中文

## 问题

Conductor runtime 移除了所有专家的通用 shell 访问，但 Headsman 和 Ralph 需要执行实现检查，Gate E 也要求 Auditor 独立验证。专家必须能够重现已配置的测试、编译器、schema validator 或 generator，同时不能让模型输出选择可执行参数、写入权限、网络访问或发布操作。

面向模型的 Conductor 调用不是授权渠道。模型生成的 owner 标签、候选路径列表、quality-command 选择或 closeout record 都不能授予写入、subprocess execution、commit、push、merge、release、publish 或 deploy 权限。

## 决策

`dsh-tool-conductor` 拥有默认空的部署 quality-command catalog。每个定义包含不透明 id、模型安全描述、精确 argv、允许的 Headsman 或 Auditor stage、规范化的 workspace 相对 cwd、可选 write root、显式 filesystem effect、固定的 `network: deny` 与 `external: none` effect、timeout、输出上限和终止宽限期。无效路径和 effect 关系会在插件加载时失败。Gate C 只选择 id；host 解析已选择的定义，并把各自的 hash 记录在 execution baseline 中。缺失、格式错误、重复或未知的 command-id 选择会生成 durable blocker，且被拒绝的 report 不会持久化。未选择的 catalog 条目发生变化不会使 run 失效。

Gate C 生成结构有效的 baseline 后，现有 approval service 拥有 effectful authorization。Approval 标识精确 baseline hash、规范化的 allowed 与 excluded path、已选择的 command id 与 definition hash，以及派生的 filesystem、quality 和 external effect。Approval 被拒绝、取消或不可用时，不会启动 write-capable child 或 quality subprocess。`authority.owner` 只用于 attribution，面向模型的工具既不接受 execution permission，也不接受 closeout authorization。Arbiter GO 后，core `closeRun` API 仍可供 host-owned channel 使用；面向模型的工具让 run 保持 `awaiting_authorization`。

spawn-in-process provider 只向 fresh child 注入私有 `conductor_quality_check`。Workflow 与 Ralph 将 callback 作为 host policy 传递，不会把它序列化给 worker program。每个 Ralph Round 的已记录目标都包含已批准的 baseline、验收标准、约束，以及绑定的 Gate-D command id 和模型安全描述。Fork、ACP 和其他进程外 provider 不声明支持，并在启动 child 前失败。

私有工具只接受 `{ command_id }`。它解析 Gate-C binding，不接受模型提供的 shell string，调用精确 argv，请求 filesystem confinement 与网络禁止，要求 sandbox backend 对该具体 policy 报告 full enforcement，并以有界方式收集输出且不创建 spill file。持久化的 `QualityExecutionRecord` 包含 identity、stage、gate、cycle、baseline 与 definition hash、时间、退出事实、outcome 以及 stdout/stderr digest，但不包含命令文本或输出正文。有界诊断可返回当前专家，但不会写入 record。

Conductor record 具有显式的预发布 format version、append-only baseline history、一个 active baseline 和一个匹配的 execution authorization。每个 Gate C pass 及其后的 gate attempt 都记录 execution-baseline hash。Scope 或 plan rework 会清除 active baseline 与 authorization，同时保留历史 baseline、gate record、specialist report 和 quality execution 以供审计。历史 evidence 仍可解析，但不能满足新的 baseline 或 gate cycle。

Quality evidence id 在 specialist report 持久化之前完成校验。每个 id 必须唯一，并属于该次 dispatch 中由 host 生成的 record。未知、历史、外部或重复 id 会触发 escalate，且无效的模型 report 不会持久化；该次 dispatch 中由 host 生成的 execution record 仍会持久化。Gate D 要求当前 cycle 中每个 Gate-D binding 都有全新且通过的 record。Ralph 可以生成 Headsman evidence，但不拥有 gate。Gate E 只接受 fresh Auditor dispatch 自己生成的通过 record；Headsman 或 Ralph evidence 不能满足该 gate。

## 已考虑的替代方案

- 拒绝向 Headsman 或 Auditor 授予通用 shell 工具，因为模型输出会选择未经审查的命令和参数。
- 拒绝让私有工具接受原始命令文本，因为这会绕过部署审查和不可变 Gate-C binding。
- 拒绝把模型提供的 owner 标签、路径列表、execution permission 或 closeout object 视为授权，因为模型无法验证 mandate owner 身份。
- 拒绝按可执行文件名称建立 denylist，因为 wrapper 和通用 runtime 可以绕过它；精确 deployment argv、host approval、filesystem confinement 与网络禁止共同拥有 enforcement。
- 拒绝对整个 catalog 做 hash，因为无关且未选择的定义会使本来未变化的 baseline 失效；已选择的 definition hash 会绑定每个可执行命令。
- 拒绝在 rework 时丢弃 quality history，因为 durable run 必须保留导致 rework 的 evidence 与 decision。
- 拒绝允许 partial sandbox enforcement，因为无法执行所请求 filesystem 与 network policy 的 backend 必须在 spawn 前 fail closed。

## 验证

- Catalog validation 冻结精确 command definition，把 effect profile 纳入每个 definition hash，拒绝重复 id、无效路径、Auditor 写入和缺少 write root 的定义，并且只允许 shell executable 作为 deployment-owned exact argv。
- Gate C 仅在 baseline 结构有效后通过 approval service 发起请求。被拒绝、取消或不可用的 approval 会生成 durable blocker，且不启动 write-capable specialist 或 quality subprocess。
- 面向模型的 schema 不包含 write、quality-execute 或 closeout authority。Capability filter 与 guard 从持久化的 baseline authorization 派生。
- Seatbelt 执行完整网络禁止。Bubblewrap 通过 `--unshare-net` 隔离 IP 网络，但通过挂载暴露的宿主 Unix 域套接字仍可访问；因此 Bubblewrap、Landlock 与 Windows ACL 对该 policy 报告 partial enforcement，quality executor 会在 spawn 前失败。普通 Bash、PowerShell 和 terminal consumer 显式请求继承网络。
- Execution 使用精确 argv，应用配置的 cwd 与 filesystem policy，限制时间与输出，不留下 spill path，并分类 timeout、cancellation、signal、runner、denial、sandbox unavailable 和普通 exit failure。
- Persistence 拒绝未知字段、过期 record version、跨 run 引用、baseline-history drift、无效时间和无效 evidence relation。Scope 与 plan rework 可以 serialize、parse 并 resume，同时保留历史 evidence。
- 未知、历史、外部和重复的 quality evidence id 会在 specialist-report persistence 前被拒绝。失败 dispatch 中由 host 生成的 record 仍保留用于审计。
- Gate D 接受 Ralph 生成的 fresh Headsman evidence；Gate E 要求独立的 fresh Auditor dispatch，且不能复用 Gate-D 或旧 baseline evidence。
- Assembled keyless scenario 覆盖 host approval、已选择 binding hash、Headsman 直接执行或 fresh Ralph execution、独立的 Gate-E execution、durable baseline lineage 以及最终的 `awaiting_authorization` 状态。Ralph 变体固定 worker 对模型可见的 baseline 与 command id，并要求 Headsman 引用该 worker 由 host 生成的 evidence，而不重新运行命令。

## 后果

- 无法同时完全执行 filesystem policy 与网络禁止的 host 不能运行 quality command。因此，内置 Linux Bubblewrap／Landlock 与 Windows ACL composition 会对 quality execution fail closed；Seatbelt 或显式断言的更强自定义 runner 可以满足该 policy。普通 shell 与 terminal call 仍显式继承网络。
- Deployment catalog 仍是可执行的 host policy。Deployment review 拥有精确 argv 与 effect declaration，runtime approval 则把已选择的定义绑定到一个 run 和 baseline。
- workspace-write backend 可能需要在配置的产品 write root 之外创建 backend 自有临时文件来启动受限进程；这些文件不属于产品写入权限。
- 缺少当前 record-format version 的既有预发布 Conductor record 会被拒绝，不会迁移。
- Arbiter GO 永远不会通过模型输入关闭 run。Host-owned caller 通过 core closeout API 记录任何获准的外部操作及其 outcome。
