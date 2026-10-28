# Agent Note: Conductor intake admission and read-only report completion

Status: implemented

English | [中文](2026-10-25-conductor-intake-and-report-completion.zh.md)

## Problem

[Issue #30](https://github.com/Biyocon/biyocon-harness/issues/30) requests entry according to supplied work and report-only completion for analysis and questions. Reassessing an existing plan must not repeat discovery and planning, and ordinary answers must not require implementation authority. Recommendations starting from an unclear task still need Strategist's planning assessment.

## Decision

The existing Conductor model proposes intake in its mandatory first `conductor` call; [runtime admission](../../../../packages/conductor/conductor/src/intake.ts) validates the proposal and derives the route. There is no intake specialist, general instruction-loader change, or new authority channel. Phase 1 supports only `purpose: implementation | analysis` and entry `detective | strategist | devils-advocate`. Analysis requires `deliverable: answer | recommendations` and at least one measurable `acceptanceCriteria` item; implementation rejects deliverable. Deliverable success requirements belong in `acceptanceCriteria`, while `constraints` holds restrictions. Empty or omitted analysis criteria fail before checkpointing or dispatch; analysis criteria must be normalized and distinct so every accepted list can be restored. Durable analysis records with invalid criteria fail explicitly. The pre-release runtime does not migrate invalid checkpoints or infer success criteria from constraints; a fresh run must supply explicit criteria. Missing fields, forbidden entries and unsupported combinations fail before a run is created.

### Captured material

Runtime captures the actual current user message, binds `current-request` to its parent Session/event provenance, and mints branded material IDs. Model-extracted scope and plan references resolve only to those captured IDs. Explicitly cited workspace-relative text files are resolved through the existing filesystem service, checked for containment and stable identity/version across the read, decoded as UTF-8, and stored with their complete content and SHA-256. Uncited paths, inaccessible or substituted files, symlink escapes and unsupported binary/attachment inputs fail explicitly. No recursive inventory or network fetch occurs.

The [tool](../../../../packages/conductor/tool-conductor/README.md) validates deployment limits for file count, bytes per input and serialized admission. It never truncates material. Captured inputs and initial skip history are checkpointed before the first child; later dispatches and resume use the stored contents. A changed purpose, entry, deliverable or supplied input requires a new run. Cited-file hashes identify those inputs, not the complete workspace or an uncommitted implementation candidate.

Detective accepts an uncertain current request. Later entries require captured scope sources, nonempty scope and acceptance criteria; C additionally requires plan sources. Later implementation entry also requires an explicitly supplied source baseline; without one, runtime reworks to Detective before dispatch. Captured input hashes never substitute for assessed source state. Analysis needs no source baseline. Missing prerequisites produce a charged `origin: intake-validation` rework to A or B before dispatch, without inventing a specialist. The first specialist assesses semantic sufficiency; code does not claim to establish the quality of prose or model conclusions.

### Validated routes

| Purpose | Entry | Deliverable | Specialist path |
|---|---|---|---|
| implementation | A/B/C | Absent | Selected entry → remaining implementation stages through C → D → E → F → G. |
| analysis | A | answer | Detective → Auditor → Arbiter. |
| analysis | A | recommendations | Detective → Strategist → Auditor → Arbiter. |
| analysis | B | answer/recommendations | Strategist → Auditor → Arbiter. |
| analysis | C | answer/recommendations | Devil's Advocate → Auditor → Arbiter. |

Recommendations beginning at Detective retain A's scope assessment and make Strategist the report producer. Other analysis combinations use the admitted A/B/C producer. Analysis C reviews a report and never an execution baseline. Implementation C retains the exact host approval of the active baseline and effects before Headsman, Ralph or Integrator; supplied work cannot replace that approval.

Bypassed gates have `kind: skipped`, decision `skipped`, supplied-work or profile-not-applicable reason, purpose/deliverable, complete route, rationale, captured material references and causal successor. They never count as evaluated passes or approvals. Only bypasses actually reached are recorded; rework may later evaluate a previously skipped gate without rewriting it.

Causal repair returns preserve C → B → C and nested C → B → A → B → C. Report defects return to the report producer; an Arbiter revision additionally requires a fresh Auditor before another Arbiter decision. The [per-gate budget](../bug-fix/2026-10-25-conductor-gate-robustness.md) remains independent: the preset allows two reworks at each deciding gate, then escalates. Admission repairs, malformed reports and revisions consume that gate's budget; skips and resume never reset it. Ralph's separate round limit is unchanged.

### Report completion and effects

A producer supplies a versioned `ReportCandidate`: deliverable, complete report content, one criterion/outcome assessment per dispatch `acceptance_criteria` item, copied verbatim in the same order, cited captured material, assumptions and limitations. Constraints never supply additional report criteria. A mismatch returns the complete expected strings and missing/extra/changed differences, including one-based changed positions. Malformed criterion/outcome items receive the expected list and their one-based item positions. Every analysis dispatch includes that criterion instruction and the durable gate history, so a fresh producer receives the repair reason rather than repeating an uninformed attempt. Recommendations include ordering and rationale in their content. Runtime hashes the candidate; Auditor reviews that exact version and its sources in a fresh session. Another fresh Arbiter session returns `accept | revise | blocked`, bound to the candidate and successful audit hashes. A revision produces a new candidate version and a new audit; stale hashes are rejected.

Acceptance yields `kind: report`, terminal status `reported`, and `currentStage: report-complete`. This is neither GO nor release/implementation approval. Justified negative findings and static-analysis limitations remain in the report. Reported runs cannot resume, close out or become implementation runs. A request to implement recommendations starts a new implementation run with a real execution-C approval.

Every analysis checkpoint retains null baseline/authorization and empty quality-execution records. [Typed dispatch](../../../../packages/conductor/tool-conductor/src/index.ts), the advertised tool allowlist and an executor guard permit only read/search and structured handoff; they exclude write/edit, shell, quality execution, approval and external actions. Forward routing, rework and resume cannot reach Headsman, Ralph or Integrator. The approval service is never called. Host Session logging is separate from project writes. The [parent routing policy](../bug-fix/2026-10-25-conductor-mode-routing.md) still denies parent tools and redispatch after every result, including reported, until new user input.

Canonical [roles](../../../conductor/README.md) and [specialist protocol](../../../skills/conductor-specialist/SKILL.md) own the purpose-specific instructions; their names and responsibility allocation remain intact. Installed copies are generated by the existing build generator, with no new source-launch generation from #25. Implementation keeps its existing report envelopes, quality policies and GO/NO-GO closeout requirements.

### Persistence

Record format 3 stores immutable admission, captured source contents/provenance, evaluated/skipped gates, pending repair returns, report versions, audits and the final report verdict. The parser replays the admitted causal route and checks material/candidate/audit hashes, references, per-gate counts, terminal state and incompatible execution fields. Old formats, including #27's version 2, are rejected explicitly without migration or compatibility aliases. Admission and each transition are checkpointed before subsequent dispatch. The existing `conductor/checkpoint` still carries opaque run JSON; no new Session event or SDK lifecycle variant is introduced.

## Alternatives considered

**A: Conductor proposes, code admits.** Selected by the owner. It reuses existing context and mandatory routing without an extra classifier, protocol or authority channel. Deterministic input checks and subsequent specialist assessment remain separate.

**B: a separate intake specialist.** Rejected because it adds unconditional model latency, cost and persistent state while still requiring the same code validation. It does not independently establish semantic correctness.

**Amended R1: producer → Auditor → Arbiter, with Strategist for Detective recommendations.** Selected by the owner. It gives questions a short read-only path, retains planning for recommendations and avoids repeating discovery for supplied plans.

**R2: selected entry through every remaining read-only A/B/C stage before audit.** Rejected because it repeats planning for simple answers and prepared plans. Prompt-only omission of C approval is also rejected: reported is a distinct typed result with enforced read-only effects.

## Consequences

Captured inputs increase bounded Session-log size and can contain sensitive project text; existing filesystem permissions and log policies still apply. Separate fresh roles establish context separation, not different models or human review. Valid references and keyless tests do not establish a provider's semantic quality or certify unexamined files.

Admission, report validation and durable-tamper tests exercise supported combinations, missing material, stale reports, causal repair/resume, independent budgets and forbidden effects. [Installed-preset snapshots](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts) use the real Loader in an external workspace with contrary AGENTS.md instructions, substitute only the model, and verify the actual first tool, specialist route, unchanged project files, no approval, parent denial and reported or blocked outcome. Dedicated cases reject empty analysis criteria without a run or child, and repair a Strategist criterion mismatch on its first Gate-B rework using the received history. Existing implementation/quality snapshots retain the host-approved path. Fixtures are recorded on Linux/WSL; SDK generic projections remain verified separately.

Phase 2 remains unimplemented: Auditor entry, `verification`, dirty candidate digests and a non-Git manifest require F02 and separate approval. Attachments, implicit conversation retrieval, remote documents, source-launch generation (#25), UI metadata (#28), and supplementary agents/providers/documents are outside Phase 1. Issue #30 therefore remains open. The runtime, quality-executor, installed-skills, routing and gate-robustness decisions remain active for their independent guarantees; none is fully superseded or archived.
