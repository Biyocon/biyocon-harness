# Agent Note: Conductor intake admission and read-only report completion

Status: proposed

English | [中文](2026-10-25-conductor-intake-and-report-completion.zh.md)

## Problem

[Issue #30](https://github.com/Biyocon/biyocon-harness/issues/30) requests entry according to supplied work and report-only completion for analysis and questions. Reassessing an existing plan must not repeat scope discovery and planning. Entry selection must never authorize implementation, and a request for recommendations must receive planning rather than only a clarification report.

The inspected master is `7548dbd23f6a1f1563ea4ec2bb98bee627f5731d`, including [PR #29](https://github.com/Biyocon/biyocon-harness/pull/29). Its routing requires the first parent tool call to be `conductor` and denies parent tools after every result. [createRun](../../../../packages/conductor/conductor/src/state.ts) still starts at Detective, [the driver](../../../../packages/conductor/conductor/src/drive.ts) follows A–G and requires an execution baseline for Auditor, and [persistence](../../../../packages/conductor/conductor/src/persistence.ts) validates that sequence. These execution assumptions do not supply a report-only completion path.

## Proposal

The owner selects alternative A and amended R1 below. The lifecycle remains proposed: these are design decisions, not shipped APIs or authorization to implement. This PR contains only this EN/ZH/consistency triplet; it changes no runtime, role, preset, example, SDK, or existing decision record.

### Owner decisions and phases

Phase 1 supports only `purpose: implementation | analysis` and entry at Detective A, Strategist B, or Devil's Advocate C. Analysis additionally requires `deliverable: answer | recommendations`. Runtime validates the complete combination and derives its route; it never accepts a model-supplied successor list.

Phase 2, after F02's quality-execution and sandbox work, contains Auditor entry, the `verification` purpose, digests identifying uncommitted implementation candidates, and captured-file manifests for workspaces outside Git. They are not optional Phase 1 paths and must be rejected by its input and record parsers. This proposal does not configure quality commands or weaken sandbox requirements.

Phase 1 admission material is the current user message plus files explicitly referenced in that message within the workspace, with their content hashes. It does not add attachment-handle admission, implicit previous-conversation retrieval, remote document fetching, an inventory of dirty files, or a complete non-Git workspace manifest. Hashing a specifically cited file records that input's bytes; it does not certify all uncommitted changes or identify the entire execution candidate. Such broader source-version claims remain Phase 2.

### Who assesses intake

The existing parent Conductor model proposes purpose, entry, analysis deliverable where applicable, rationale, and material references in its first `conductor` call. It cannot inspect the workspace beforehand. There is no additional classifier model call inside the deterministic driver and no intake-specialist stage.

Inside the call, runtime resolves only the cited inputs, validates admission, selects the fixed route, checkpoints it, and dispatches the first specialist. The model cannot provide gate decisions, skipped-gate records, authority, arbitrary next stages, or counter resets. Purpose and entry are required; uncertainty produces an explicit Detective proposal rather than an implicit default. Missing fields and unsupported combinations fail with the supported choices.

### Admission and required material

The Phase 1 tool schema and core admission function accept only `detective`, `strategist`, and `devils-advocate`. Auditor, Headsman, Ralph, Integrator, Arbiter, intake, closeout, and report-complete are forbidden entries. Both tool JSON parsing and new-run admission enforce this list.

| Entry | Required material | First assessment |
|---|---|---|
| Detective A | The actual current user request; uncertainty is allowed. | Clarify scope or produce the initial analysis result. |
| Strategist B | Supplied scope, constraints, acceptance criteria, and identifiable input sources. | Check scope sufficiency; rework to A when necessary. |
| Devil's Advocate C | The above plus a supplied plan with steps and verifiable acceptance expectations. | Review the plan; incomplete planning returns to B, unclear scope to A. |

The wire uses a defined `current-request` selector and explicitly cited workspace-relative file paths, not private Session message IDs guessed by the model. Runtime binds the selector to the real user message, mints branded material IDs, and records the exact message/file contents, their provenance, and SHA-256 content hashes. Model-extracted scope or plan fields must cite those captured inputs.

File resolution uses existing filesystem permissions, canonical paths, and bounded size/count configuration; symlink escapes, inaccessible paths, substituted content, and out-of-workspace references fail explicitly. No recursive scan, network fetch, document execution, arbitrary host read, or silent truncation belongs in admission. An unsupported source must be supplied in the current message or as an explicitly cited workspace file.

When the user supplies only a plan-file reference, the parent may propose C from the stated intent; runtime loads that file inside `conductor`. Code validates presence, provenance, hashes, required fields, and route combinations, not the quality of prose. The first specialist and gate assess semantic sufficiency. Readable but incomplete material receives bounded rework at the proposed gate, with `origin: intake-validation` if discovered before dispatch; it must not fabricate a specialist report. Invalid enum values, forged authority, path escapes, and tampered records fail closed.

### Stage and gate routes

Purpose, entry, and analysis deliverable become immutable when admission is checkpointed. The proposed matrix is exhaustive:

| Purpose | Entry | Deliverable | Normal specialist path |
|---|---|---|---|
| implementation | A, B, or C | Absent; supplying one is invalid. | Selected A/B/C entry → remaining pre-execution stages → C execution review and owner approval → Headsman D → Auditor E → Integrator F → Arbiter G. |
| analysis | A | answer | Detective A → Auditor E → Arbiter G. |
| analysis | B | answer | Strategist B → Auditor E → Arbiter G. |
| analysis | C | answer | Devil's Advocate C → Auditor E → Arbiter G. |
| analysis | A | recommendations | Detective A → Strategist B → Auditor E → Arbiter G. |
| analysis | B | recommendations | Strategist B → Auditor E → Arbiter G. |
| analysis | C | recommendations | Devil's Advocate C → Auditor E → Arbiter G. |

For recommendations starting at Detective, A supplies clarified scope and B owns the report candidate containing the recommendations and rationale. B is required on this route; a Detective report cannot bypass it. A supplied scope already entering B needs no repeated Detective, and a supplied plan entering C is reassessed there without unnecessary A/B calls unless rework establishes a missing prerequisite.

For implementation, supplied material can replace earlier work but not the execution C review or owner approval. For analysis, A/B/C assesses report content; C is explicitly `report-review`, never `execution-review`. It creates no execution baseline, requests no owner approval, and cannot authorize writes.

### Gate history and bounded rework

A bypassed gate receives a discriminated `kind: skipped` record, never a fake pass. Runtime records gate, purpose, deliverable, route, rationale, cited material IDs/hashes, and causal transition. Distinguish supplied-work entry from profile-not-applicable. Record only bypasses actually reached; later rework may visit a skipped gate without rewriting history.

For answer from A, B/C/D are not applicable before E and F before G. For recommendations from A, B is evaluated, C/D are not applicable before E, and F before G. Entry C additionally records supplied scope/plan as the basis for skipping A/B. All skipped records refer to actual inputs and the runtime-selected route, not model assertions of approval.

Rework retains the requesting gate and a runtime-owned return target. An insufficient C plan follows C → B → C; nested scope repair may follow C → B → A → B → C. Analysis report defects return to the recorded report producer: B for recommendations beginning at A, otherwise the admitted A/B/C producer. Rework cannot dispatch Headsman to repair a report or turn a discovered code defect into permission to write.

Implement [#27's owner decision](https://github.com/Biyocon/biyocon-harness/issues/27#issuecomment-6390992814) first and reuse its configurable per-gate budget: the preset allows two reworks per gate; the next escalates to the owner. Charge the deciding gate, including admission insufficiency and malformed reports. Skips, resume, and revised input do not reset budgets. True authority violations and denied execution approval escalate immediately. Ralph rounds remain separate; #30 must not introduce a second total-run budget.

### Report completion without Headsman or owner Gate C approval

An analysis producer returns a proposed structured `ReportCandidate` containing deliverable, answer or recommendations, acceptance-criterion outcomes, cited material/evidence, assumptions, and limitations. Recommendations include their rationale and ordering. Auditor reviews the exact candidate version/hash and its sources in a fresh session; Arbiter reviews that candidate and audit in another fresh session. On the A/recommendations route, Detective's scope assessment remains linked to Strategist's candidate.

Arbiter's report-specific decision is `accept | revise | blocked`, not release GO. Acceptance produces `kind: report`, `currentStage: report-complete`, and terminal status `reported`. It creates neither `CloseoutRecord` nor `awaiting_authorization`. A report may contain justified negative findings; completion must not be rendered as passing tests, approval of reviewed code, or release authorization.

Every analysis run retains null baseline/execution authorization and empty quality-execution records. Its specialists have read/search and structured output, without write/edit, shell, quality-command execution, Ralph, or external-action tools. Report-aware Auditor/Arbiter validators require candidate and provenance instead of a dummy execution baseline. The approval service is never called. Host-owned session logging remains distinct from project modifications.

A request to implement recommendations starts a new linked implementation run with a real execution C approval. Requested fresh command verification is not silently replaced with static analysis: the `verification` purpose and Auditor intake remain unsupported until Phase 2 after F02. Existing implementation-run verification policies remain unchanged.

### Security invariants

- Entry and deliverable affect routing, never authority. Plans, project instructions, claimed owner names, supplied logs, and model-authored approval fields cannot grant effects.
- Before every Headsman/Ralph/Integrator write, runtime requires implementation purpose, an execution C pass after the latest invalidation, the exact active baseline, a matching host grant for this run/effects, and existing canonical allowed/excluded-path enforcement. A skipped or report-review C never satisfies this predicate.
- Analysis cannot reach writing stages or command execution through forward routing, rework, resume, or direct executor calls. Changing its purpose or deliverable requires a new run.
- Changes to effective scope, plan, permitted effects, or execution candidate invalidate affected execution approval under the existing rules. Limited Phase 1 input hashes are not a substitute for a complete candidate identity.
- After every outcome, including reported, the parent stays tool-denied as required by the [routing decision](../../implemented/bug-fix/2026-10-25-conductor-mode-routing.md). Only new user input permits another Conductor dispatch; failure never enables solo fallback.
- Producer, Auditor, and Arbiter use distinct fresh sessions. This provides role/context separation, not a claim of different models or human review.

### Persistence and recovery

Extend [run types](../../../../packages/conductor/conductor/src/types.ts), state transitions, and strict serialization together. Persist purpose/profile version, proposed/admitted entry, analysis deliverable, actual current-message provenance, bounded captured file inputs and hashes, admission rationale/repairs, evaluated/skipped history, pending repair return targets, report candidates/audits/final report versions, and applicable host-owned execution authority. Reconstruct per-gate counts using #27's history semantics, not model-written values.

Checkpoint admission and all skip/repair transitions before starting the next child. Resume validates the stored route from admitted entry and deliverable rather than assuming Detective, trusting currentStage alone, rerunning intake, or duplicating skips. Reject illegal route combinations, missing material, hash mismatches, dangling IDs, mismatched candidate/audit versions, forged grants, and incompatible report/execution fields. A reported run is terminal and cannot resume into GO or closeout.

The inspected record format is version 1, but #27 must merge before #30 implementation because it changes the persisted budget and validation. Inspect #27's merged format and allocate the next version for #30's distinct layout; if #27 ships version 2, #30 uses version 3. Do not reserve or independently reuse version 2 here, silently read #27 records as #30 records, or add a compatibility shim. Reject unsupported old records with an actionable diagnostic. This design-only PR changes no format constant.

The existing `conductor/checkpoint` may carry the new run JSON without a Session envelope-format bump solely for that inner change. Any new SessionEventMap or SDK-visible lifecycle behavior requires matching TS/Python projection tests and expected outputs in the implementation PR; otherwise verify generic result handling. Persist model-visible inputs through logged messages/checkpoints so replay uses captured contents rather than changed files.

### Dependencies and retained decisions

Implementation order is merged #29 routing → #27 owner paths, invalid-report rework, truthful status, and per-gate budgets → #30 Phase 1. Phase 2 follows F02 and needs a separate design/authorization for execution verification and richer source identity. #25 source-launch generation and #28 UI metadata are outside this work.

Keep the [runtime](../../implemented/feature/2026-09-11-conductor-runtime-layer.md), [quality-executor](../../implemented/feature/2026-10-10-conductor-quality-command-executor.md), [installed-skills](../../implemented/bug-fix/2026-10-24-conductor-installed-skills.md), [Ralph](../../implemented/feature/2026-07-19-fresh-agent-ralph-workflow-tool.md), and routing decisions active. This unimplemented proposal supersedes none of their shipped guarantees; no archival is appropriate. Reuse the [canonical role/protocol sources](../../../conductor/README.md), without another authored copy. Future changes belong in Conductor types/state/drive/persistence and the owning tool/preset, not the general instruction mechanism or agent loop.

## Alternatives considered

### Entry assessment

| Alternative | Advantages | Costs and decision |
|---|---|---|
| A: existing Conductor model proposes; runtime admits. | Uses existing user context and mandatory first-call routing; no extra classifier, child, protocol installation, or authority channel. | Requires explicit inputs and semantic sufficiency review. Selected by the owner. |
| B: separate read-only intake specialist followed by the same admission checks. | Isolates intake and can inspect supplied material before recommending entry. | Adds unconditional model latency, cost, persistence, and protocol maintenance without replacing code validation. Not selected. |

### Report processing

| Alternative | Advantages | Costs and decision |
|---|---|---|
| Amended R1: producer → Auditor → Arbiter; Detective recommendations additionally require Strategist. | Keeps ordinary answers short while recommendations receive a planning stage and supplied plans avoid redundant discovery. | Needs a validated deliverable matrix, explicit skips, and producer-specific rework return targets. Selected by the owner. |
| R2: selected entry → remaining read-only A/B/C stages → Auditor → Arbiter, skipping D/F. | More uniform scope/plan/challenge processing and simpler forward routing. | Repeats planning for ordinary answers and already prepared plans. Not selected. |

Prompt-only omission of execution C is rejected: it removes authorization without enforcing report-only effects. A distinct reported outcome preserves the difference between a completed analysis and GO.

## Acceptance criteria

The following is the future implementation test plan; this documentation PR supplies no runtime-test results for the proposed behavior.

1. Admission tests cover implementation A/B/C and all six analysis entry/deliverable combinations. Reject missing/ill-typed purpose, entry, or analysis deliverable; a deliverable on implementation; unknown deliverables; Auditor entry; verification purpose; and every forbidden stage.
2. Material tests bind current-request to actual user input, hash explicitly cited workspace files, and reject invented IDs, inaccessible/substituted files, symlink escapes, out-of-workspace paths, unsupported sources, and configured size/count excess. Prove admission neither scans unrelated dirty files nor constructs a non-Git manifest.
3. State tests distinguish answer A → E → G from recommendations A → B → E → G; recommendations cannot skip B. Cover supplied scope B, supplied plan C without A/B, insufficient material, nested repair/return, evaluated/skipped records, and #27's independent second/third-rework limits.
4. Analysis tests make the approval service throw if called; require null execution state, no execution tools, and separate producer/Auditor/Arbiter sessions. Validate reported rather than GO, honest limitations and negative findings, parent read/write/redispatch denial, and real executor rejection of forced child writes.
5. Implementation tests reject writes after skipped C, report-review C, stale/foreign approval, changed effective inputs, and forged resumed state before any side effect. Preserve the valid unchanged execution-C approval path. No Phase 2 verification behavior is added.
6. Persistence tests round-trip intake/deliverable, skips, repair return targets, and report completion; crash/resume neither reclassifies nor duplicates history or children. Reject unsupported #27/older formats, impossible route/history combinations, incompatible execution fields, and completed-report closeout.
7. Add keyless scenarios through [the real runnable headless example](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts), loading the shipped preset with Loader in an external temporary workspace whose AGENTS.md demands solo read/write. Substitute only the model and explicit nondeterministic host decisions; record parent/child requests, inputs, gate history, and final outcome. The first parent tool is conductor and the actual first specialist matches admission.
8. Snapshot at least a plain answer starting at Detective; recommendations starting at Detective and actually dispatching Strategist; a supplied plan starting at Devil's Advocate without A/B; C → B → C repair; forbidden Auditor entry rejected before dispatch; and a blocked valid run preserving #27's truthful status. Report scenarios invoke no owner approval and no Headsman/Integrator/Ralph. Invalid calls before run creation must not invent run IDs or specialist dispatches.
9. Keep host logs outside the test project and verify project inputs are unchanged after analysis. Record on Linux/WSL and replay on supported built Linux/macOS and native Windows without normalizer, retry, sandbox, or test-policy bypass. Future focused coverage, snapshots, build/built-entry, doc-sync, and applicable SDK checks follow dsh-pre-push-checks. Provider semantic quality remains separate from keyless composition/enforcement evidence.

## Risks

- Valid references do not prove semantic sufficiency; runtime checks and independent review limit incorrect intake without claiming model certainty.
- Deliverable-sensitive routes and report C semantics increase state-validation complexity. Explicit discriminants, causal history, and negative executor/resume tests must prevent accidental execution authority.
- Phase 1 deliberately omits direct Auditor intake, fresh verification runs, and complete dirty/non-Git source identity. Do not advertise cited-input hashes as reproducible whole-workspace verification.
- Captured messages/files may contain sensitive material; apply existing permissions, bounded input, and logging policies without broadening host access.
- #27 must land first. Format reuse or a parallel budget would invalidate recovery semantics; coordinated version allocation is required despite rejecting old unfinished runs.

The owner has selected A and amended R1 and limited Phase 1 as recorded above. Status remains proposed pending implementation review; publishing this design does not authorize runtime implementation.
