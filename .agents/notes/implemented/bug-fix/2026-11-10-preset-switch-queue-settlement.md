# Agent Note: Release the exact settled preset-switch queue entry

Status: implemented

English | [中文](2026-11-10-preset-switch-queue-settlement.zh.md)

## Problem

The API serializes preset choices for each blank session. Its queue retained a rejection-handled promise but compared the entry against the original promise when settling. Those are distinct objects, so the session's entry could never be released.

## Decision

[Preset selection](../../../../packages/host/apiproxy/src/api-proxy.ts) names the exact rejection-handled promise placed in the queue and compares that same object during cleanup. A settled request releases only its own entry. If another choice has already replaced the entry, the earlier request leaves it intact. Unexpected provider rejections remain contained in the retained promise, allowing later requests to proceed.

## Alternatives considered

**Compare against the original request promise.** Rejected because `catch()` creates a different promise; the identity comparison cannot succeed.

**Delete the session entry unconditionally.** Rejected because an earlier request could remove a later choice's serialization owner and allow overlapping recompositions.

## Consequences

Completed choices do not retain queue entries indefinitely. Two pending choices preserve order, preserve the session and agent identities, and append preset-selection events only after successful recomposition. Started sessions remain locked. Unit evidence covers concurrent choices, typed mount refusals, an unexpected non-stringifiable provider rejection and a later successful choice. No wire, record, model input or visible-copy change is introduced. This fix was found while exercising the API proxy for [#55](https://github.com/Biyocon/biyocon-harness/issues/55); coverage-policy changes are separate from the queue's ownership rule.
