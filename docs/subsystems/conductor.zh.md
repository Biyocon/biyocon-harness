# Conductor 运行时与子会话显示

[English](conductor.md) | 中文

本参考页涵盖 [dsh-conductor](../../packages/conductor/conductor/README.md) 拥有的持久所有者台账及模型不可见子会话显示数据。运行和门禁策略仍由包 README 定义；通用子会话发现由 [Subagent](subagent.md) 定义。

记录 v4 将 `GateRecord[]` 与[所有者交互类型](../../packages/conductor/conductor/src/owner-types.ts)分离。`OwnerQuestion` 绑定根会话、运行、门禁索引、子会话尝试、捕获报告及哈希、授权修订号和完整必答项。`OwnerInteraction` 在单调所有者修订号下记录问题、原子预留回答/计划、一次性消费或拒绝。两类运行校验器都强制验证因果历史。`awaiting_owner` 和 `continuation_pending` 在重启后可重建，但普通模型驱动恢复拒绝它们。Conductor 专属宿主控制器保留并消费一个精确计划；UI 交付前生产回答仍不可用。版本 3 明确拒绝且不迁移。[所有者交互提案](../../.agents/notes/proposed/feature/2026-10-30-conductor-owner-escalation-resumption.md)将 UI 留待 P3。

`OwnerTransportBinding` 绑定运行、问题、根会话、修订号及新的传输 ID。`OwnerInteractionEvent<K>` 携带一个可判别的台账条目与可选回答传输信息。四种必读所有者事件仅进入日志；[持久化目录](../persistence-catalog.md#conductor)拥有其声明。检查点写入中断后，存储校验并协调完整所有者事件；相同重复回答返回已保存回执，已消费但派发情况不明时继续停放。宿主继续执行上下文从已保存回答及有效授权派生，另行记录为插件 `user/message`。它既不授予 Gate C 批准，也不开放普通父级工具。

[`ConductorChild`](../../packages/conductor/conductor/src/child-types.ts)包含具体 `childId`、`runId`、运行时 `role`、按角色从 1 开始的 `attempt`、派发 `historyOffset` 以及 `status: running | completed | failed`。`ConductorChildRole` 是七个专家阶段加 `ralph`。可选 `gate` 包含 `id`、`decision`、`reworks`、`limit`，属于该子会话自身已评估的报告，而非该角色最新的结果。Ralph 没有专家门禁结果。

父 Session 记录完整 `conductor/child` 快照。`conductorChildren` 投影仅替换该 child id 的条目，并在 `session/end-seed` 清除继承条目。子会话生命周期独立于门禁接受。这些必读事件不增加模型输入或执行权限。[决策记录](../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md)解释派发归属、持久化及替代方案。
