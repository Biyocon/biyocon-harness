# Agent Note: Enforce coverage for the generic question editor

Status: implemented

English | [中文](2026-11-10-generic-question-composer-coverage.zh.md)

## Problem

[Issue #55](https://github.com/Biyocon/biyocon-harness/issues/55) tracks coverage exemptions for the generic question editor and the API proxy. An exemption prevents the exhaustive gate from detecting new untested editing behavior, even when existing component tests already exercise most paths.

## Decision

The [generic question editor](../../../../packages/client/ui-user-questions/src/client/QuestionComposer.tsx) participates in the normal per-file 100% statements, branches, functions and lines gate. Tests exercise option-keyboard submission only after the entire batch is complete, ignore other keys and incomplete batches, and show non-Error cancellation failures while restoring interaction. Existing tests retain navigation, drafts, localization, IME composition, typed takeover and transport evidence. Product behavior is unchanged.

## Alternatives considered

**Retain the exemption until API proxy coverage is complete.** Rejected because the two files have independent responsibilities and can enter the gate separately.

**Ignore the remaining branches or lower thresholds.** Rejected because ordinary user actions and transport failures reach them.

## Consequences

New uncovered editor paths fail the existing exhaustive gate. No ignore directives, skips, timeout changes or retries are added. The API proxy's separate exemption is outside this decision; this change does not complete all of #55.
