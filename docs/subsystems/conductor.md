# Conductor runtime and child presentation

English | [中文](conductor.zh.md)

This reference covers the durable owner ledger and model-hidden child presentation owned by [dsh-conductor](../../packages/conductor/conductor/README.md). Run and gate policy remain in the package README; generic child discovery is defined by [Subagent](subagent.md).

Record v4 separates `GateRecord[]` from the [owner interaction types](../../packages/conductor/conductor/src/owner-types.ts). `OwnerQuestion` binds root session, run, gate index, child attempt, captured report/hash, mandate revision and complete required items. `OwnerInteraction` records question, atomically reserved answer/plan, single consumption or rejection at monotonic owner revisions. Both run validators enforce this causal history. `awaiting_owner` and `continuation_pending` reconstruct on restart, while ordinary model-directed resume refuses them. The Conductor-owned host controller reserves and consumes one exact plan; the shipped preset enables typed browser answering through that controller. Version 3 is rejected without migration. The [owner-interaction decision](../../.agents/notes/implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md) owns authority, routing and recovery semantics.

`OwnerTransportBinding` binds run, question, root session, revision and a fresh transport ID. `OwnerInteractionEvent<K>` carries one discriminated ledger entry and optional response transport. The acknowledgement payload binds `runId`, `questionId`, the answer/rejection ledger `revision`, and `status: accepted | rejected`; a receipt matches all three identities to its recorded response. The five required-on-read owner events are log-only; `conductor/owner-response-acknowledged` certifies the already flushed response checkpoint inside the same host turn, rather than adding a ledger revision or granting continuation; the [persistence catalog](../persistence-catalog.md#conductor) owns their declarations. The store validates and reconciles complete owner facts after an interrupted checkpoint; duplicate identical replies return the saved receipt, while ambiguous consumed dispatches remain parked. Host-authored continuation context is separately logged as a plugin `user/message`, derived from the saved answer and effective mandate. It grants neither Gate C approval nor ordinary parent tools.

```ts type-equiv
/** Receipt certifying that the exact answer checkpoint passed the host flush barrier. */
interface OwnerAcknowledgement {
  runId: ConductorRunId
  questionId: string
  revision: number
  status: 'accepted' | 'rejected'
}
```

[`ConductorChild`](../../packages/conductor/conductor/src/child-types.ts) names a concrete `childId`, its `runId`, runtime `role`, one-based per-role `attempt`, dispatch `historyOffset`, and `status: running | completed | failed`. `ConductorChildRole` is the seven specialist stages plus `ralph`. Optional `gate` contains `id`, `decision`, `reworks` and `limit`; it belongs to the child's own evaluated report, not the latest result for its role. Ralph has no specialist gate verdict.

The parent Session logs complete `conductor/child` snapshots. The `conductorChildren` projection replaces only the entry at that child id and clears inherited entries at `session/end-seed`. Child lifecycle is independent of gate acceptance. These required-on-read events add no model input or execution authority. [The decision record](../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md) explains dispatch attribution, persistence and alternatives.
