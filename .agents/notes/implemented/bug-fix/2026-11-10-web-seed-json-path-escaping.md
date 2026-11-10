# Agent Note: JSON-safe browser seed paths

Status: implemented

English | [中文](2026-11-10-web-seed-json-path-escaping.zh.md)

## Problem

[Issue #66](https://github.com/Biyocon/biyocon-harness/issues/66) identifies raw Windows path substitution in browser JSONL fixtures. Backslashes and quotes can invalidate the session header before a browser starts. Rewriting the recorded header's decoded cwd against serialized text can also miss escaped paths.

## Decision

The [seed realizer](../../../../apps/web/tests/scaffold.ts) encodes replacement paths and session IDs as JSON string contents. It also encodes the recorded cwd before replacing its occurrences in the serialized fixture. Header and event text therefore use the same workspace, and repeated realization preserves the text. Malformed header JSON still fails explicitly. The [browser-lane decision](../testing/2026-07-24-web-gui-browser-e2e-lane.md) remains active; the change only fixes seed substitution, not browser normalization or runtime path handling.

## Alternatives considered

**Escape only the cwd placeholder.** The subsequent recorded-path replacement still compares decoded paths with JSON-escaped text and can leave the wrong source path in events.

**Normalize goldens or raise test timeouts.** Neither repairs invalid fixture JSON or incorrect source identity.

## Consequences

[Regression tests](../../../../apps/web/tests/seed-fixture.spec.ts) realize the committed seeded-history fixture with Windows, UNC and POSIX paths, check escaped recorded paths and quoted IDs, and retain malformed-header rejection. The tests use synthetic paths and no owner session data. Existing browser goldens retain their meaning.
