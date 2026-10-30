# Conductor 运行时与子会话显示

[English](conductor.md) | 中文

本参考页涵盖 [dsh-conductor](../../packages/conductor/conductor/README.md) 拥有的持久所有者台账及模型不可见子会话显示数据。运行和门禁策略仍由包 README 定义；通用子会话发现由 [Subagent](subagent.md) 定义。

记录 v4 将 `GateRecord[]` 与[所有者交互类型](../../packages/conductor/conductor/src/owner-types.ts)分离。`OwnerQuestion` 绑定根会话、运行、门禁索引、子会话尝试、捕获报告及哈希、授权修订号和完整必答项。`OwnerInteraction` 在单调所有者修订号下记录问题、原子预留回答/计划、一次性消费或拒绝。两类运行校验器都强制验证因果历史。`awaiting_owner` 和 `continuation_pending` 在重启后可重建，但 P1 的普通恢复拒绝它们；仅脚本化测试提供者消费计划。版本 3 明确拒绝且不迁移。[所有者交互提案](../../.agents/notes/proposed/feature/2026-10-30-conductor-owner-escalation-resumption.md)将生产控制和 UI 留待后续阶段。

[`ConductorChild`](../../packages/conductor/conductor/src/child-types.ts)包含具体 `childId`、`runId`、运行时 `role`、按角色从 1 开始的 `attempt`、派发 `historyOffset` 以及 `status: running | completed | failed`。`ConductorChildRole` 是七个专家阶段加 `ralph`。可选 `gate` 包含 `id`、`decision`、`reworks`、`limit`，属于该子会话自身已评估的报告，而非该角色最新的结果。Ralph 没有专家门禁结果。

父 Session 记录完整 `conductor/child` 快照。`conductorChildren` 投影仅替换该 child id 的条目，并在 `session/end-seed` 清除继承条目。子会话生命周期独立于门禁接受。这些必读事件不增加模型输入或执行权限。[决策记录](../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md)解释派发归属、持久化及替代方案。
