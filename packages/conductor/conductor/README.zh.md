# @deepseek-ai/dsh-conductor

[English](README.md) | 中文

Conductor runtime 拥有 run 状态、A–G gate、按缺陷类别的 rework 路由、source/execution baseline 以及显式 closeout record。`SessionConductorRunStore` 在每次转换后向父 Session 日志追加完整的键控 checkpoint 并执行 flush；恢复只接受最后一个已记录 gate 的状态，并拒绝 terminal 或 escalated run。预发布 record 携带显式格式版本，不支持的 record 会在不迁移的情况下被拒绝。

实现专家把 `SpecialistEnvelope` 返回给 Conductor，绝不自行选择下一个专家。Gate C 提议不可变 execution baseline，其中包含由部署解析的 quality-command binding 及其 definition hash。在 Gate C 通过之前，host 必须授权精确的 baseline hash 及其 effect profile：实施所需的 workspace write、存在绑定命令时的 catalog quality execution，以及无 external effect。拒绝授权或 approval provider 不可用都会在 Headsman 启动前阻塞 run。已授权 baseline 保留在 append-only history 中；scope 或 plan rework 只清除 active baseline 和 authorization，保留旧证据，但旧证据不能满足后续 baseline。

Headsman 与 Auditor 必须精确引用当前 dispatch 产生的持久化 `QualityExecutionRecord` id，而不能引用命令文本或旧证据。Gate D 与 Gate E 都要求对应 gate 绑定的每个命令具有全新的通过证据，且 Gate E 只接受其独立 Auditor cycle 产生的证据。Gate G 记录 Arbiter 决策；GO 会保持 `awaiting_authorization`，直到 mandate owner 通过 host-owned closeout API 提供 outcome evidence 与 traceability。Runtime 只记录 closeout，不执行 commit、push、merge 或 deploy。`ConductorAuthority` 仅标识 mandate owner，不授予 execution 或 external-action capability。

`maxReworkPerGate` 按各 `GateRecord.gate` 独立限制返工决策，默认值为 2。限制为 2 时，同一门禁第三次请求返工即升级；另一门禁的决策不消耗其预算。结构无效的 envelope、Arbiter 决策和 Gate C baseline 使用缺陷类别 `report` 返回报告角色；无效报告不保存为已验证的专家报告。身份、所评估 baseline、路由、证据或权限违规，以及宿主批准遭拒，立即升级。Ralph Round 保持自身独立且未变化的限制。

Gate C 提案只包含版本、rollback reference 和请求的质量命令 id，不包含路径字段。运行时从所有者授权的运行提供 `allowedPaths` 和 `excludedPaths`，并拒绝专家编写的路径。完整解析 baseline 仍须获得精确宿主批准。`SpecialistExecutionFailure` 在保存已完成宿主质量记录的检查点后传播基础设施故障，不伪造专家报告或门禁决策。记录格式 3 保存不可变 intake、已评估/跳过历史、因果返工和报告版本，以及实现证据；明确拒绝版本 2 及更旧记录，不做迁移。[门禁稳健性决策](../../../.agents/notes/implemented/bug-fix/2026-10-25-conductor-gate-robustness.md)记录验证分类及验证证据。

准入目的为 `implementation | analysis`，入口为 Detective、Strategist 或 Devil's Advocate。分析要求 `answer | recommendations`：回答使用所选生产者 → Auditor → Arbiter；从 Detective 开始的建议还要求 Strategist 生成报告。已提供工作及不适用的 gate 记录为 `kind: skipped`，绝不是批准。返工返回缺失前提，再返回请求的 gate，重用逐 gate 预算。准入捕获当前用户文本和明确引用的工作区文本文件及内容哈希；恢复验证捕获路线和材料。实现从较晚入口开始时，若未明确提供源 baseline，运行时将其返工至 Detective；输入内容哈希绝不是源 baseline。

分析保持空执行状态且不执行质量命令。版本化报告经独立审计后，Arbiter 返回 `accept | revise | blocked`；接受终止为 `reported`/`report-complete`，而非 GO 或 closeout。从不请求批准或到达 Headsman、Ralph、Integrator。[准入决策](../../../.agents/notes/implemented/feature/2026-10-25-conductor-intake-and-report-completion.md)拥有来源、报告绑定和延期第二阶段行为。

## 已知限制与延期工作

- 只有 host 挂载持久化 Session provider 时，checkpoint 才具备跨进程持久性；内存 Session 只在当前进程生命周期内保留记录。
- Conductor 记录已授权的外部 closeout 操作及其证据，但按设计不执行 release 操作。
