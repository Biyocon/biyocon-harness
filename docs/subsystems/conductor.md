# Conductor child presentation

English | [中文](conductor.zh.md)

This reference covers model-hidden child presentation owned by [dsh-conductor](../../packages/conductor/conductor/README.md). Run and gate policy remain in the package README; generic child discovery is defined by [Subagent](subagent.md).

[`ConductorChild`](../../packages/conductor/conductor/src/child-types.ts) names a concrete `childId`, its `runId`, runtime `role`, one-based per-role `attempt`, dispatch `historyOffset`, and `status: running | completed | failed`. `ConductorChildRole` is the seven specialist stages plus `ralph`. Optional `gate` contains `id`, `decision`, `reworks` and `limit`; it belongs to the child's own evaluated report, not the latest result for its role. Ralph has no specialist gate verdict.

The parent Session logs complete `conductor/child` snapshots. The `conductorChildren` projection replaces only the entry at that child id and clears inherited entries at `session/end-seed`. Child lifecycle is independent of gate acceptance. These required-on-read events add no model input or execution authority. [The decision record](../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md) explains dispatch attribution, persistence and alternatives.
