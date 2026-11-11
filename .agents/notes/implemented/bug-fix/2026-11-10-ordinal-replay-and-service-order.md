# Agent Note: Locale-independent replay and service-name order

Status: implemented

English | [中文](2026-11-10-ordinal-replay-and-service-order.zh.md)

## Problem

Default `localeCompare` uses host collation. Danish treats the `aa` sequence differently from English, reversing the expected order of synthetic session IDs and leaked service names in [#93](https://github.com/Biyocon/biyocon-harness/issues/93). A recorder and replay host with different locales can disagree about same-time child order.

## Decision

[ACP harvest](../../../../packages/test-support/acp-snapshot/src/harness.ts) and [replay loading](../../../../packages/test-support/llm-replay/src/index.ts) retain their primary/creation-time rules and compare tied session IDs in UTF-16 code-unit order. [Preset rejection](../../../../packages/preset/agent-presets/src/mount.ts) uses the same ordinal order for leaked service names. These are technical identities, not natural-language labels. Existing language-sensitive presentation elsewhere is unaffected.

This clarifies the ID tiebreak in [per-session snapshot replay](../testing/2026-06-22-subagent-snapshot-replay.md), without changing script derivation, durable events or fixture formats. Header ordering does not establish first-call causality: concurrent-child recording still requires the separate ordinal design identified there.

Assembled keyless validation also requires an owned instruction root. The ACP harness creates a workspace-local `.git` marker after copying fixture files and before custom preparation or agent launch, preserving any existing marker. The empty marker is not a Git repository and appears in explicit directory listings. This keeps real replay examples from inheriting developer instructions through an ancestor project; the inheritance snapshot asserts the marker before launching its agent.

## Alternatives considered

**Pin collation to English.** Rejected because linguistic case and punctuation rules are unnecessary for technical identities; ordinal comparisons do not depend on ICU collation data.

**Change expected output for Danish.** Rejected because that preserves host-dependent record/replay assignment and inconsistent diagnostics.

**Change the machine locale.** Rejected: supported developer locales must not require global settings changes.

## Consequences

English- and Danish-default collation cases exercise the real preset guard, persisted ACP harvest and replay loader. The test double changes only default collation and preserves explicitly requested locales; each case restores the native method. The same child IDs and diagnostic names retain the same order on either host. No credentials, private logs, Conductor dependency, record-version change or GUI change is introduced.
