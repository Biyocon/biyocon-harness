# Agent Note: Open chat with unavailable Conductor runs

Status: implemented

English | [中文](2026-11-06-conductor-unsupported-record-history.zh.md)

## Problem

A saved Conductor checkpoint can use an unsupported format or contain invalid data while the surrounding Session log still contains readable chat history. The owner controller previously parsed the checkpoint during `agent/created`; a parse failure prevented the entire session from opening. Rejection during opening confused a run-resume rule with a chat-read rule.

## Decision

Read-only inspection classifies each latest checkpoint by runId as current or unavailable and extracts only a safe integer format number, or `null` when unavailable. The owner controller skips unavailable runs while rebuilding question state and determining the active phase, and logs the runId and format without record content. The Conductor projection publishes only unavailable runIds and formats; its state survives seeded-session replay and removes an entry on a later valid checkpoint or tombstone. The Conductor UI presents the localized status in its panel above the composer and in the session header that remains visible with Forløb selected. No control for the old run is offered there.

Actual use still loads the latest checkpoint through the strict `SessionConductorRunStore` and fails with `ConductorRunUnavailableError`; resume and owner answer/continuation cannot recover invalid state. The controller does not create an owner question for it, so there is no stale question to cancel. A new Conductor task mints a different runId and leaves the old checkpoint intact. No migration or fallback to an earlier checkpoint occurs. The invariant companion tolerates invalid checkpoints that predate installation so the session can open, but rejects newly appended invalid checkpoints.

## Alternatives considered

**Migrate old records on open.** Rejected because legacy formats have no compatibility promise, and an inferred conversion could grant actions or owner authority from unverified state.

**Hide the entire session.** Rejected because chat history remains readable independently of Conductor run state.

**Resume from the previous valid checkpoint.** Rejected because the latest checkpoint is authoritative for a runId; skipping it would silently rewind the run.

## Consequences

Old runs remain visible as unavailable, including invalid current-format records whose format number is still shown. Strict action failures are explicit and do not log record contents. The status is shown in the Conductor panel and the persistent session header, including while Forløb is selected; it is not inserted into the model-visible chat or the historical Forløb event ledger. Synthetic format-4 tests cover opening, preserved chat, rejection, redacted logging, projection, and a distinct new run. A keyless shipped-preset snapshot covers the assembled model flow. The original record remains available for a later owner decision.
