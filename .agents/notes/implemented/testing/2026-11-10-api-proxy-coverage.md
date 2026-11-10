# Agent Note: Enforce complete API proxy coverage

Status: implemented

English | [中文](2026-11-10-api-proxy-coverage.zh.md)

## Problem

The API proxy's file-wide exemption prevented the exhaustive coverage gate from detecting missing tests for existing RPC routes and lifecycle branches. [Issue #55](https://github.com/Biyocon/biyocon-harness/issues/55) requires that exemption to end after meaningful coverage reaches the repository's normal per-file thresholds.

## Decision

The [API proxy](../../../../packages/host/apiproxy/src/api-proxy.ts) participates in the normal 100% statements, branches, functions and lines gate. Tests call its public RPC methods with real Session, Inbox, Goal, Workspace and storage-domain services where those services own the behavior. External provider failures and native application openers use controlled doubles. Fixtures are synthetic and contain no owner sessions, credentials or private material.

Coverage includes durable image-reference authorization, cancellation and replay cuts, exact session ownership, provider metadata, successful and failed mutations, ordered requests, and host-frame lifecycle. Negative cases exercise the actual executor or event consumer. The [preset-switch queue fix](../bug-fix/2026-11-10-preset-switch-queue-settlement.md) corrects an identity mismatch found during this work.

Search retains cancellation checks after its visibility snapshot and provider awaits, and before adapting provider failures. The duplicate check at iteration entry is removed: the intervening cursor and result processing is synchronous and introduces no scheduling point before the next provider await. Existing cancellation-priority and bounded-pagination tests remain enforced.

## Alternatives considered

**Keep the exemption or lower thresholds.** Rejected because either permits future untested RPC behavior.

**Add ignores or manipulate signal getters to reach redundant checks.** Rejected because the tests must exercise actual scheduling and public behavior.

**Exercise native openers against the owner's desktop.** Rejected: the gateway tests prove delegation using controlled opener doubles; the opener package owns platform-adapter behavior.

## Consequences

New uncovered API paths fail the exhaustive gate. No ignores, skips, retries or timeout extensions are introduced. Per-file coverage complements the assembled keyless browser scenarios and does not prove every interleaving or real-provider behavior. The question editor's independent coverage decision is documented [separately](2026-11-10-generic-question-composer-coverage.md).
