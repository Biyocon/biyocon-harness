# Agent Note: Inspectable subagent settlement assertions

Status: implemented

English | [中文](2026-11-11-subagent-settlement-assertion.zh.md)

## Problem

[Issue #67](https://github.com/Biyocon/biyocon-harness/issues/67) reports intermittent activation waits whose assertion is masked by `PrettyFormatPluginError: cannot get property "$$typeof" without inject`. Vitest's formatter traverses a retained Agent's scoped Cordis context. The formatting failure reproduces with an idle synthetic Agent, independently of coverage or slow settlement; it does not explain why a child remains live.

## Decision

The [control suite's settlement wait](../../../../packages/subagent/tool-subagent-control/tests/tool-subagent-control.spec.ts) asserts on the registry result's optional ID instead of the whole Agent. An Agent always has an ID, so the absence condition is unchanged. A failed check retains the actual identity without formatting scoped services. The five-second timeout, polling mechanism and runtime remain unchanged.

The regression creates a real registry-owned Agent and observes the actual polling callback through a call-through spy. Its failing callback must produce an AssertionError with that Agent's ID. Disposing the handle lets the original wait finish; the test neither waits for a timeout nor replaces the waiting implementation.

## Alternatives considered

**Change Cordis or the formatter.** Rejected because the assertion needs only identity, not a serialization of scoped services.

**Assert only a boolean.** Safe to format, but loses the retained Agent's identity.

**Increase the deadline.** Rejected: more waiting cannot repair error rendering and would obscure the unresolved activation issue.

## Consequences

The diagnostic regression fails with the formatter error before the change and passes afterward. Existing settlement tests still exercise the real registry and persistence path. This is a test-diagnostic correction, not a fix for #67's intermittent lifecycle failure; that issue remains open. No product/model output, snapshot, durable format or private data changes.
