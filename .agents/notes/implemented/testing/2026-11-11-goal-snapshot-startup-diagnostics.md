# Agent Note: Goal snapshot startup diagnostics

Status: implemented

English | [中文](2026-11-11-goal-snapshot-startup-diagnostics.zh.md)

## Problem

The goal-round and wrap-up ACP snapshots require empty stderr even though the shipped ACP composition opens a derived SQLite query index. Node 24.13 emits an experimental-feature notice when that index imports `node:sqlite`, so a successful goal lifecycle fails before its transcript assertions run.

## Decision

The two goal snapshots accept silence or exactly one complete Node SQLite startup notice. The matcher anchors both ends of the raw string, permits the process-id digits and LF/CRLF line endings, and requires the exact warning and trace-warnings hint. It does not strip, normalize, or suppress diagnostics. Unknown warnings, incomplete or duplicate notices, extra newlines, errors, and stack traces fail.

The existing launch resolver already derives `lib/bin.js` from `src/bin.ts` when built mode is selected. No explicit built-entry override or launcher change is necessary. The warning originates from the ordinary query engine, not a source-mode fallback; production composition and SQLite use remain unchanged.

The [ACP replay mechanism](2026-06-19-acp-snapshot-tests.md) and [goal-round lifecycle](../feature/2026-07-19-same-session-goal-round-driver.md) remain unchanged. This decision owns only the two goal scenarios' startup-diagnostic assertions.

## Verification

Positive and negative diagnostic cases pin the exact accepted output. Both real ACP scenarios replay their existing fixtures through source and built entry points and retain goal rounds, cancellation, wrap-up, and wire/session golden assertions. No fixture or expected transcript is rewritten.

## Alternatives considered

- **Suppress all Node warnings or scrub stderr**: hides unrelated startup failures and weakens the diagnostic assertion across scenarios.
- **Disable the query index in the goal fixture**: changes the shipped composition that the lifecycle proof is intended to exercise.
- **Require an explicit built entry**: duplicates the resolver's existing path derivation without addressing the warning.

## Consequences

Node versions that emit no notice and those that emit the exact known notice share the same lifecycle proof. A changed diagnostic remains a reviewable test failure; unrelated snapshot suites and production stderr are unaffected.
