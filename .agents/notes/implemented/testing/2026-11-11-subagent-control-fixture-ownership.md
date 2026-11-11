# Agent Note: Subagent-control fixture ownership

Status: implemented

English | [中文](2026-11-11-subagent-control-fixture-ownership.zh.md)

## Problem

The subagent-control suite removes JSONL scratch directories after tests without closing most Cordis roots. A local observer of the unchanged suite finds thirteen retained contexts and fourteen registered agents after fifteen passing tests; twelve directories disappear while their registries still contain agents. Process exit is not quiescent fixture teardown. A failed test can also leave its scripted model waiting on a gate that no test code reaches to release.

## Decision

The [suite](../../../../packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts) owns every created context, scratch root and model gate. Teardown starts context disposal, releases all owned gates, and waits for every disposal before removing scratch data. This includes partially constructed fixtures and the plugin-unload scenario. Idempotent gate release preserves ordinary test scheduling while allowing cleanup after an early assertion failure.

If any context fails to close, teardown waits for the other contexts, reports an aggregate error and retains the failed owners and all scratch directories for subsequent cleanup. It never deletes files while closure is uncertain. Existing removal retry settings are unchanged; no settlement deadline, polling policy or product lifecycle changes.

The [inspectable settlement assertion](2026-11-11-subagent-settlement-assertion.md) remains independently necessary. Closing fixture owners fixes a verified test-resource leak, not the unproven cause of [#67](https://github.com/Biyocon/biyocon-harness/issues/67)'s historical activation timeout. That issue remains open.

## Verification

A real held child must drain and leave an empty agent registry before the removal callback can delete its existing directory. A failed-disposer case proves that other contexts still close while every directory remains. The focused control suite retains its original activation assertions and coverage. Observer comparisons measure actual registry entries at test completion, not scoped-service proxy identity.

## Alternatives considered

- **Rely on worker exit or garbage collection**: neither closes each fixture before the next test or before its files disappear.
- **Release gates without awaiting context disposal**: allows final persistence and model work to race deletion.
- **Wait longer for activation removal**: does not repair fixture ownership and could hide the unresolved liveness failure.

## Consequences

Cleanup owns unfinished work and exposes teardown failures without changing runtime behavior, model output, snapshots or durable formats. The diagnostic observer and its raw metadata stay local; committed fixtures contain only synthetic test data.
