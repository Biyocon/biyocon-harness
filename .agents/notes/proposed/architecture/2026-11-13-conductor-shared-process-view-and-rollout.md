# Agent Note: Shared Conductor process view and qualified rollout

Status: proposed

English | [中文](2026-11-13-conductor-shared-process-view-and-rollout.zh.md)

## Problem

Harness and Super-Desktop expose different process surfaces and embed different engine revisions. Matching portraits, version strings or completed workers cannot prove matching gates, owner authority or running-app updates. Two independent interpretations of records would drift even after packaging succeeds.

## Proposal

Extend the [portable-bundle delivery plan](2026-11-11-portable-conductor-bundle.md) with one canonical, versioned presentation model and paired application qualification. This proposal is the repository review source; external coordination files are informational. Only the owner grants decisions, merges and Gate C authorization. A planning acknowledgement grants none. Keep Conductor code in its packages and separate UI plugins; any necessary generic core edit needs file, purpose and PR in the [dependency inventory](2026-11-05-conductor-core-dependencies.md). Core never imports Conductor.

### Ordered deliveries and ownership

Harness-Codex owns engine, host bundles and Harness rendering; the PI owner owns separately authorized Super-Desktop integration. Each uses its own worktree and mutable outputs. Prefer one active implementation PR per repository and no speculative stacks. Each prerequisite follows normal checks, review and owner-controlled merge before consumption.

| Milestone | Required delivery and dependency |
| --- | --- |
| R0 | Record source/base, host, engine/resource hashes, built artifact and actual running identities separately. Define scope and ownership; a merged source is not an updated app. |
| R1 | After [#113](https://github.com/Biyocon/biyocon-harness/pull/113) is merged, open one draft implementation PR against master with `## Resumé (dansk)`. Register required event declarations from the composed profile before persistence reads/replay; preserve the four proofs below. |
| R2 / 4a | After R1 delivery, qualify a clean rc.7 installation solely from packed artifacts, without workspace links, source copies or manual preset transfer. |
| R3 / 4b | After 4a, repeat compatibility against one pinned newer host with the same canonical engine artifacts and its thin host bundle. Biyocon stays on rc.7. |
| R4U | After 4b, deliver the shared projection below and optional Web UI plugin; preserve child/critic, unavailable-run and owner-question/receipt presentation. Optional describes installation, not permission to omit this delivery. |
| R4 | Hand PI the qualified engine/host/UI exports, model version, artifact hashes, supported records, host matrix and refusal rules; no draft dependency or implicit repin. |
| R5 | Separate adapter/common-chat design and explicit owner decision, including session/transport security review, before any change to owner-action access. |
| R6H / R6S | After R5 approval, each owner implements only necessary host/backend integration and proves producer-to-projection lineage. PI changes its engine pin only through explicit qualified delivery. |
| R7H / R7S | Both render the same projection and reviewed chat layout. They are two rendering layers, not two backend interpreters. |
| R8–R11 | Paired acceptance, final source-integration qualification, separately authorized data-safe update, then verification of both running artifacts and owner acceptance. Requalify affected evidence after candidate changes. |

R1 must prove synthetic Conductor history opens with the bundle, clearly refuses before replay without it, ordinary chat works without it, and cold restart neither rewrites history nor repeats model/tool work. Unsupported run records retain chat and unavailable-run presentation with the bundle, while actual run operations remain refused. These proofs supplement, not replace, the packed-install gates. The [isolated quality rehearsal](../testing/2026-11-13-conductor-isolated-quality-rehearsal.md) is independent and does not block R1.

### One versioned presentation model

R4U owns one pure event/run-record projection in `packages/conductor/*`, consumed by both apps. Its output version is independent of Conductor record format 5; unknown model versions fail explicitly rather than falling back to app-specific interpretation. It produces run/role/dispatch identities, attempts, gates, evidence, rework/invalidation, explicit skipped steps and owner interaction state with traceable source positions/hashes. Preserve separate host, engine and interaction lifecycle values.

The input must identify one consistent run-record/event prefix and a host-attested durable acknowledgement position. R4U must specify and test how that position is established; a streamed checkpoint, completed worker, renderer state or model text cannot manufacture it. Gates become passed only when their validated record and required evidence fall within the acknowledged prefix. Contradictory, invalid or unsupported inputs produce explicit diagnostics/unavailable state, never plausible success or migration. Tests cover partial prefixes and delayed acknowledgements as well as complete replay.

Fold owner questions and acknowledged responses by exact root session, run, question and revision; expose at most one active form for that question/revision. Historical receipts are read-only. Metadata describing a form is not authority to submit it. Host transport reservations, single-use consumption, rejection and durable acknowledgement remain authoritative. Both renderers consume the projected states without recomputing gates, choosing another latest record or parsing verdicts from prose.

Keyless tests use synthetic valid, invalid and unsupported records, stale/wrong-run/duplicate questions, repeated attempts, rework, missing evidence and reload. Both apps consume the same versioned projected fixtures and prove equivalent semantics; native visual tests verify the actual presentation. No private session content enters fixtures or logs.

### R5 owner decision and common chat target

Identical owner forms in both apps change the [#111](https://github.com/Biyocon/biyocon-harness/pull/111) decision: adapter v1 permits only start/status/result/resume, refuses pending-owner resume, and leaves owner answers/approvals in host UI. Neither this roadmap nor projection exports approve that change. R5 requires an explicit new owner decision and security review of session/transport binding, trusted host ownership, stale/double answers, persistence and replay before implementation. Internal types are references, not an approved external owner API.

Review one in-chat process card/timeline, matching role/attempt/gate order, reports/evidence, rework, errors and one active owner area with historical receipts. A separate dashboard or a link to another host form alone is not full in-chat parity. Freeze EN/DA references, keyboard/focus behavior and declared platform exceptions. Super-Desktop Danish support is planned, not assumed from its existing locales.

Use isolated per-host data and one host per run. Shared-home writers or same-run concurrent clients require separately approved/implemented [#87](https://github.com/Biyocon/biyocon-harness/pull/87) and qualified host access. Protect the owner's active apps/data; do not migrate or resume private runs during qualification. The shared v6 design for #75/#30/#58 remains separate: no record bump or invented `incomplete` status is needed for current-format UI qualification.

## Alternatives considered

**Two record interpreters.** Matching fixtures initially would not prevent later divergence in gate, evidence or owner semantics; share the pure projection and version negotiation.

**Approve forms through this roadmap.** It would silently broaden adapter-v1 authority; retain R5 as a new owner/security decision.

**Treat checkout tests as installation or update proof.** They do not establish packed dependency closure, another host's behavior or the running app identity; keep 4a/4b and cutover qualification separate.

## Acceptance criteria

Every row runs against both exact candidates with synthetic inputs, acknowledged backend receipts, projection version/hash, native evidence and explicit pass/fail/not-run. Lower-layer tests are not whole-app acceptance; keyless fixtures are not live-model quality.

| ID | Required scenario and observable result |
| --- | --- |
| P01 | Open history without dispatch, provider calls or writes. |
| P02 | Read-only analysis shows actual roles, explicit skips and its real result; no writes. |
| P03 | Implementation proves Conductor plus all seven specialist dispatches, an actual harmless scoped change, exact C approval/applicable tool permission and fresh independent D/E executions. Printed role names do not count; Ralph requires real dispatch. |
| P04 | Clarification and mandate amendment bind exact question/revision/items and proposal hash; no implicit execution approval. |
| P05 | Gate C and tool permission stay separate; changed baseline invalidates consent. |
| P06 | Wrong-run, stale, duplicate and concurrent answers fail without duplicate continuation or premature success. |
| P07 | Plan/design and implementation rework preserve attempts, target and downstream invalidation. |
| P08 | GO/NO-GO and analysis outcomes come from validated engine records; no external delivery authority. |
| P09 | Missing required catalog is a setup problem; empty initial execution evidence is normal; changed admission requires a new run. |
| P10 | Missing/tampered engine/bundle and invalid/unsupported records follow refusal/unavailable rules without false success. |
| P11 | Reopen, reload and cold restart preserve history without repeated work or rewrites. |
| P12 | Cancellation/interruption/cleanup failure fence late callbacks and expose uncertain effects. |
| P13 | Chat switches, delayed reads and reconnect cannot update another run/session. |
| P14 | Compare common EN/DA views, actual screenshots/interaction recordings, mouse/Enter/Space, focus and narrow layout; preserve other locales. |
| P15 | Fresh install, supported history and incompatible downgrade have explicit data-safe accept/refuse rules. |
| P16 | After owner-authorized update, both normal app paths report the delivered engine/bundle/UI identities and pass the agreed smoke. |

## Risks

A durable frontier may require a small generic host extension; do not infer acknowledgement or relax security to avoid it. Partial UI refactoring can break existing cards; preserve their evidence and runnable snapshots. Scope-specific inputs, hashes and errors must not leak secrets. Owner review can reject R5; the preceding v1 installation/view work remains useful without claiming full form parity.

Supersession audit: the portable-bundle proposal retains packaging, replay and v1 authority; this note adds delivery/projection detail and an explicit later decision point. The [rc.7 slice](../../implemented/architecture/2026-11-12-conductor-rc7-host-bundle.md), [owner resumption](../../implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md), [child status](../../implemented/bug-fix/2026-10-28-conductor-child-role-status.md), [unavailable history](../../implemented/bug-fix/2026-11-06-conductor-unsupported-record-history.md) and [session format rule](../../implemented/architecture/2026-08-10-session-log-version-mechanism.md) retain independent active guarantees. No implemented triplet is fully superseded or archived.
