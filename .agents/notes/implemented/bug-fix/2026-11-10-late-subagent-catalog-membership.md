# Agent Note: Refresh catalog membership after late subagent identity

Status: implemented

English | [中文](2026-11-10-late-subagent-catalog-membership.zh.md)

## Problem

A host can publish a child session before its descriptor is appended. The child enumerator intentionally omits sessions without their own descriptor. A browser catalog refreshed from the earlier publication can therefore remain empty while the child is already running: the later identity projection previously updated only the session's projection values.

## Decision

The generic [SessionManager](../../../../packages/client/runtime/src/client/sessions/manager.ts) schedules its existing debounced catalog refresh when a `subagent` projection arrives for a known direct child of the selected parent or an open catalog. Session lineage comes from the host summary; the client neither folds descriptor events nor interprets Conductor records. Changes during an in-flight request retain the existing trailing-refresh behavior. Unknown sessions, ordinary forks, unparented sessions and closed, unselected catalogs do not cause requests. Publication arriving after the projection remains covered by the existing host-session listener.

The [critic browser scenario](../../../../apps/web/tests/conductor-critic.e2e.ts) waits for the pending critic row and, when applicable, the completed Arbiter row before comparing existing goldens. A host checkpoint alone does not prove that the browser has received the corresponding child projection. Timeouts and goldens are unchanged.

## Alternatives considered

**Wait longer or retry the whole scenario.** Neither causes a stale catalog to refresh. A deterministic unit regression reproduces the missing late-identity refresh without timing or a model.

**Conductor-specific client events.** Rejected because descriptor-backed children share this creation window. The runtime depends on generic subagent identity and authoritative host lineage, never on Conductor.

**List descriptor-less children.** Rejected because ordinary forks and inherited descriptors must not become authorized subagents.

## Consequences

Selected and expanded catalogs recover when identity becomes available, including after an older response is already in flight. The wire protocol and persisted records are unchanged. The browser may make one additional debounced catalog request at descriptor publication; duplicate projection frames can also request a refresh. Unit tests cover selected/open parents, excluded recipients and the in-flight response race. The assembled critic scenario retains its pending/settled and English/Danish evidence rather than accepting a partial catalog snapshot.
