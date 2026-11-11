# Agent Note: Preserve persisted-state timeout diagnostics during slow reads

Status: implemented

English | [中文](2026-11-11-acp-persisted-wait-diagnostics.zh.md)

## Problem

[Issue #101](https://github.com/Biyocon/biyocon-harness/issues/101) exposes an ACP snapshot wait that rejects with Vitest's generic timeout instead of the awaited state. `vi.waitFor` retains a callback failure only after that asynchronous callback rejects. When the deadline expires during the first log read, no callback error exists. Coverage load can expose this window even when the stored log correctly fails the requested condition.

## Decision

The seven asynchronous persisted-state waits in the [ACP harness](../../../../packages/test-support/acp-snapshot/src/harness.ts) share one private poller. Its initial failure names the awaited state before I/O begins. Completed failed inspections replace that failure, retaining existing parser and I/O diagnostics. The unchanged deadline rejects with the latest completed failure; a successful inspection arriving afterward cannot satisfy the wait. Inspections remain serial with the existing interval. The synchronous workspace-marker wait retains `vi.waitFor`.

One controller stops the interval, and the poller drains its current inspection before returning. Filesystem reads are not cancellable through this harness, so draining can extend cleanup beyond the acceptance deadline. It neither starts another inspection after timeout nor accepts the late result. Scenario cleanup removes only its owned scratch paths after draining. No agent runtime, model input, session format, exported signature or tunable changes.

## Alternatives considered

**Increase the timeout or retry CI.** A slower first read can exceed any fixed deadline; neither establishes a diagnostic before that read. Existing limits remain meaningful and unchanged.

**Match Vitest's generic error text and replace it.** This couples the harness to an internal library message and does not stop pending I/O before scratch cleanup.

**Use `expect.poll`.** The installed implementation permits a last inspection after expiry and can accept a late success. Persisted readiness requires the existing deadline to reject that outcome.

## Consequences

Timeouts identify the requested persisted state even before the first inspection completes. Earlier closed turns, open turns, incomplete JSONL records and malformed starts retain their rejection behavior. Completed inspection errors keep their original identity; an uncompleted inspection cannot supply an error that has not yet been observed.

Regression cases drive the real `runScenario` subprocess and delay a real synthetic-log read beyond its unchanged 20 ms deadline. Both an older closed turn and a requested turn discovered late reject with the named diagnostic. Read and cleanup observations verify that scratch removal does not race the pending read. Owning tests cover all seven consumers; built keyless ACP replay checks cancellation and background completion without changing fixtures or normalizers. The evidence uses only synthetic sessions.
