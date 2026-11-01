# Agent Note: Conductor owner paths, report repair and truthful outcomes

Status: implemented

English | [中文](2026-10-25-conductor-gate-robustness.zh.md)

## Problem

[Issue #27](https://github.com/Biyocon/biyocon-harness/issues/27) documents a run that dispatched Detective, Strategist, and Devil's Advocate but returned only a Gate C path-validation blocker. The parent could not distinguish that progress from a failure before dispatch. Model-written baseline paths also made a structurally incorrect report stop the run, and a shared rework count let one gate consume another gate's repair budget.

## Decision

Runtime owns the complete execution baseline. The Gate C specialist proposes only scope, plan and acceptance versions, rollback reference, and quality-command ids. The schema omits owner paths. The resolver rejects specialist-written paths and copies only the run's authorized `allowedPaths` and `excludedPaths`; command bindings remain host-resolved. No report can widen scope. The full baseline still requires the exact host approval before Headsman, Ralph, quality execution, or Integrator receives its existing capabilities.

### Report defects and authority failures

Malformed envelopes, missing structured output from a completed child, invalid baseline proposals, and malformed Arbiter decisions use `report` rework to the same reporting role. The driver records the rejection and checkpoints before starting a fresh child. Invalid reports do not enter the validated specialist-report list; their original model output remains in the child log. Structural validation checks nested evidence, findings, change requests, and handoff metadata before downstream code uses them.

Identity, assessed-source, routing, quality-evidence, or authority violations escalate immediately rather than receiving report retries. Explicit recoverable clarification, host-validated mandate proposals and exhausted recoverable report repair instead use the [durable owner-question controller](../feature/2026-10-30-conductor-owner-escalation-resumption.md); answers do not waive integrity checks or Gate C approval, and its per-gate owner reassessment budget never resets automatic rework. Host authorization rejection, cancellation, or unavailability never dispatches Headsman. A failed workflow/child propagates as `SpecialistExecutionFailure`; the driver checkpoints its completed host quality records before rethrowing it, without adding a synthetic envelope or gate verdict. Actual child lifecycle events determine whether a role started; an accepted or queued agent call is insufficient. Temporary workflow observers are removed even when disposal fails. The existing full-sandbox and exact-command policies remain unchanged.

### Per-gate budget and persistence

`maxReworkPerGate` replaces the total-run budget. It is a validated positive safe integer; both the tool default and shipped preset use 2. `reworkCycles(run, gate)` counts only history records whose `GateRecord.gate` matches and decision is rework. Two reworks at one gate are allowed; its next requested rework becomes escalate with the exhausted limit in the recorded basis. Other gates remain independent. Ralph rounds retain their separate existing limit.

Record format 4 retains the per-gate budget and report-defect routing alongside [intake and report completion](../feature/2026-10-25-conductor-intake-and-report-completion.md). The parser rejects format 3 and older records, removed budget fields, excess per-gate reworks and report repair routed to another role, without compatibility migration. Intake, analysis terminal, UI metadata and source-launch generation are separate decisions; the latter two remain outside this work.

### Outcome evidence

Both blocked and decision tool results carry run id, reached stage, status, full gate history with reasons, and the roles represented by actual runtime gate attempts. Rejected reports remain represented even though they are absent from validated specialist reports. Pre-creation errors explicitly say that no run was started; post-creation infrastructure errors include the last durable checkpoint and any failed child known to have started, without inventing a gate decision. GO still requires separate owner-controlled closeout, and the parent remains tool-denied after every result.

### Retained decisions and verification

Keep the [runtime](../feature/2026-09-11-conductor-runtime-layer.md), [quality-executor](../feature/2026-10-10-conductor-quality-command-executor.md), [installed-skills](2026-10-24-conductor-installed-skills.md), and [routing](2026-10-25-conductor-mode-routing.md) decisions active. Their authorization, isolation, installation, and parent restrictions still apply; this changes only report repair, owner-path construction, budget counting, persisted validation, and status reporting. No note qualifies for archival.

Focused tests cover the second/third rework, independent gate budgets, same-role correction, malformed nested fields, immediate authority/approval failure, durable quality evidence, old-format rejection, and truthful tool results. The real runnable installed-preset headless example covers a rejected Gate C path proposal followed by a fresh corrected report and owner-bound baseline, plus exhaustion and a blocked result retaining completed roles and gate history. Existing closeout, Headsman/Ralph quality, and installed-resource snapshots retain their policies. Fixtures are recorded on Linux/WSL; generic SDK projections require no changed SessionEventMap because the existing checkpoint still carries opaque run JSON.

## Alternatives considered

- **Accept or silently normalize model-written path fields:** rejected because the model would keep authoring authority-shaped data. Omitting the fields and explicitly rejecting them makes their runtime ownership visible and testable.
- **Escalate every malformed report immediately:** rejected because repairable output-format errors would require owner intervention despite a safe bounded retry. Authority and evidence violations remain immediate escalations.
- **Keep a total-run budget alongside the per-gate limit:** rejected because one gate could still exhaust another's repairs and the additional tunable has no current owner requirement.
- **Build #30 intake or read-only completion at the same time:** rejected because those change stage and terminal semantics independently. A–G, Ralph, and owner-authorized closeout remain intact.

## Consequences

Malformed reports can spend two fresh-child retries at each gate before escalation, increasing token use while bounding repair. The operator receives the actual gate path rather than a single blocker sentence. Old unfinished records require a fresh run, and supplied plans or reports still cannot grant execution authority. The shipped empty quality-command catalog and existing platform sandbox limitations are unaffected.
