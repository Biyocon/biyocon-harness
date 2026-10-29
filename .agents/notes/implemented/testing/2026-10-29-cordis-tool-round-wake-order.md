# Agent Note: Complete Cordis activation before the stop prompt

Status: implemented

English | [中文](2026-10-29-cordis-tool-round-wake-order.zh.md)

## Problem

Cordis activation delivers an asynchronous notification that can open a turn without another user message. A browser scenario that submits its stop request after the initial turn, while activation is still completing, lets scheduling determine which turn consumes each recorded response. Waiting for the next turn end does not identify the message that completed. Checking only the latest visible completion can miss a queued failing turn, and a golden containing that failure can then accept it.

## Decision

The [Cordis browser scenario](../../../../apps/web/tests/cordis-tool-round.e2e.ts) orders three complete turns: the initial request finishes while approval is pending; the test approves activation and waits for the notification's turn; only then does it submit the stop request. The prompt assigns the notification a text-only `CORDIS_UI_ACTIVE` response. The browser marker remains present after this response and disappears after the real stop call.

`assertCompleteCordisLifecycle` requires exactly three `turn/end` events, all with `reason: completed`, alongside the four expected successful Cordis calls. The record-mode driver applies this assertion before harvesting the fixture. Replay applies it before comparing the conversation golden, so a failed turn cannot become an acceptable UI baseline.

The session fixture and UI golden come from a successful execution through the [real web replay lane](2026-07-24-web-gui-browser-e2e-lane.md). The existing recording scrubbers and normalization rules remain unchanged. The shared `whenTurnSettled` API retains its next-turn semantics; the scenario establishes which work may run before each wait is registered.

## Alternatives considered

**Delay STOP or retry a failed replay.** A delay does not identify the completed work, and a retry can select a favorable ordering. Neither proves a complete conversation.

**Hold activation notifications until STOP arrives.** This is useful as a negative scheduling experiment, but shipping that fixture would change notification delivery to preserve an underspecified recording. It would not exercise a distinct activation turn before the stop request.

**Refresh the failed UI or check only the last completion.** These approaches can preserve an error as expected output or inspect completion before queued work fails. The transcript and every turn ending must agree on success.

## Consequences

The recording includes one explicit activation acknowledgment in addition to the request and stop responses. This costs a model response when recording and makes the conversation's causal order reviewable. Product code, approval behavior, timeouts, retry policies and normalizers are unchanged.

## Verification

The focused browser file checks real approval, the mounted browser marker, all turn endings, successful tool results and the conversation golden. Record and replay both reject an incomplete or failed turn lifecycle.
