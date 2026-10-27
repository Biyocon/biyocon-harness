# Agent Note: Observe completed ACP turns without sampling their open state

Status: implemented

English | [中文](2026-10-27-acp-completed-turn-observation.zh.md)

## Problem

Background settlement and goal wrap-up can finish a parent turn between the snapshot harness's filesystem polls. Waiting for an open `turn/start` before waiting for `turn/end` loses that completed turn and reports a timeout even though the durable log contains both records. Waiting for any closed turn instead can accept the earlier spawn turn and dispose the application before the background work finishes.

## Decision

The [ACP harness](../../../../packages/test-support/acp-snapshot/src/harness.ts) accepts `minimumTurn` on `waitForTurnEnd`. The selected session must contain that numbered `turn/end`, and its latest complete turn boundary must be closed. Completed evidence remains valid after the turn finishes. Only newline-terminated records count; an in-progress trailing fragment cannot establish completion. Cancellation readiness retains the open-turn requirement of `waitForTurnStart`.

The four background-subagent scenarios and goal-wrapup wait directly for completed parent turn 2. The [settlement fence](../feature/2026-08-06-manager-owned-subagent-settlement-delivery.md) still ensures that background delivery opens its own parent turn. Default timeouts, polling intervals, runtime scheduling, transcripts, and expected-output comparisons are unchanged.

## Alternatives considered

Longer timeouts and repeated test attempts cannot recover an open turn that has already closed. Accepting any historical start in the cancellation waiter would allow cancellation after its intended turn finished. Keeping the start/end pair preserves the race; waiting for an unnumbered end can mistake turn 1 for the required background completion.

## Consequences

Snapshot scripts express durable completion instead of depending on observing a transient state. Missing or still-open required turns continue to fail. The change affects test orchestration only; no model-visible input, product behavior, SDK output, or normalization rule changes.

## Verification

A deterministic subprocess regression supplies an already-closed turn 2, reproduces the failed open-turn wait, and passes with numbered completion. Negative cases reject a closed turn 1 and an open turn 2. The real `subagent-list-agents` replay reproduces the timeout when its first observation is delayed by 250 ms: the captured log contains a complete turn 2 lasting about 10 ms. Unmodified repeated replay alone can pass because the defect depends on scheduling. Focused keyless replays retain their committed expected transcripts.
