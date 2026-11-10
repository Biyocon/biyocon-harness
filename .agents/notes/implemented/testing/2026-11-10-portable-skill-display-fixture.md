# Agent Note: Portable paths in the seeded skill disclosure

Status: implemented

English | [中文](2026-11-10-portable-skill-display-fixture.zh.md)

## Problem

The seeded skill disclosure renders a complete recorded tool result. On Windows, its native path acquires escaped backslashes when Playwright quotes the multiline instruction region. The unescaped workspace prefix cannot match that ARIA spelling, producing [#89](https://github.com/Biyocon/biyocon-harness/issues/89) despite correct JSONL hydration and unchanged visible instructions.

## Decision

The [scenario](../../../../apps/web/tests/skill-tool-row.e2e.ts) realizes its native session header separately from its recorded events. Recorded display paths use the same workspace with forward slashes; the host retains its native cwd for ownership and persistence. Both spellings address the same Windows directory. The existing seed backend still validates and persists the log through its normal API.

The browser compares the entire displayed instruction string with the seeded tool result, checks its base directory explicitly, and uses the display spelling when capturing the existing ARIA golden. Instructions, usage and the shared ACP recording remain unchanged. No product path handling or snapshot normalizer changes.

## Alternatives considered

**Normalize additional escaped spellings globally.** Rejected for this scenario: source fixtures can provide portable display paths without widening normalization across unrelated UI text.

**Accept a Windows-specific golden or remove the path.** Rejected because either weakens cross-platform parity or stops checking a meaningful part of the instruction result.

## Consequences

The same golden checks the real persisted session and rendered disclosure on native Windows and Linux. Native session identity remains independent of the fixture's display spelling. This is a seeded rendering test; it does not claim a new skill execution or actual filesystem read.
