# Agent Note: Resume Conductor escalations through durable owner questions

Status: proposed

English | [中文](2026-10-30-conductor-owner-escalation-resumption.zh.md)

## Problem

[Issue #37](https://github.com/Biyocon/biyocon-harness/issues/37) describes run CON-2026-4272: Strategist requested authority for six files and clarification of two plan choices, but Gate B escalated without asking the owner. Starting another run loses the connection between the question, the specialist's evidence, and the owner's answer.

On master b0d5825b6fa17e9ffb395e2996e16a4a00f34ca2, [resume validation](../../../../packages/conductor/conductor/src/persistence.ts) rejects escalated runs, and [intake history validation](../../../../packages/conductor/conductor/src/intake-history.ts) treats escalation as terminal. [Dispatch validation](../../../../packages/conductor/conductor/src/drive.ts) also groups legitimate authority requests with integrity failures. Making every escalation resumable would let an owner response waive checks that must remain mandatory.

[Gate C](../../../../packages/conductor/tool-conductor/src/index.ts) already obtains host-owned approval for an exact execution baseline. [ApprovalService](../../../../packages/interaction/user-approval/src/index.ts) has no free-text answer, while [UserQuestionService](../../../../packages/interaction/user-questions/src/index.ts) supports questions but does not persist a Conductor continuation. The [API proxy](../../../../packages/host/apiproxy/src/api-proxy.ts) keeps pending requests in memory: browser reconnection and host restart therefore have different recovery requirements.

## Proposal

Park a recoverable escalation as a durable owner question, then resume the same run through a Conductor-owned host controller. Reuse the existing question transport and root-agent identity checks with a typed Conductor interaction; keep Gate C's approval service separate. P1 delivers the record and validator foundation below; the production interaction remains proposed for P2/P3.

The seven specialist roles and their responsibilities remain unchanged. The owner supplies decisions and clarification, not a new specialist report or a gate pass. Implementation and analysis retain their existing routes; this feature does not add intake entries, analysis criticism, providers, domain agents, or document formats.

### Implementation phases

P1 is delivered as the record-v4 domain foundation: an append-only owner ledger, exact child/report provenance, validated amendments and per-gate reassessment limits, with strict analysis and implementation reconstruction. Conductor child write validation rejects Git metadata even under a broad workspace mandate, including canonical aliases. It remains test-provider-only: existing required-on-read `conductor/checkpoint` events carry the complete ledger, and no new session event type, live answer controller, resumption turn, routing hook or UI is enabled. Dedicated interaction events and SDK event additions belong to P2. Installed-preset keyless scenarios exercise scripted acceptance, rejection and unavailable-provider parking. The note deliberately remains proposed until P3 delivers the complete interaction. Existing version-3 runs are rejected and cannot resume after upgrading.

Implement #37 in three successive PRs, in this order. Stop after each PR for review by the owner and Claude; approval of the design or an earlier phase does not authorize the next phase or a merge.

| Phase | Scope | Verification and review stop |
|---|---|---|
| P1 | Record v4, owner-interaction ledger, escalation classification, and validators, including per-gate owner reassessment limits. | Exercise admission, answers, counter limits, and persistence with scripted host responses; stop for review before P2. |
| P2 | Conductor-owned host controller, durable answer/resumption turn, and routing guard. | Exercise same-run continuation, crash/cancellation boundaries, stale replies, and parent tool denial; stop for review before P3. |
| P3 | Typed owner-question UI card with EN/DA, accessible controls, browser e2e, and a GIF. | Verify the real interaction through the app; record the GIF from a PR server on port 3090 and publish it on a separate assets branch; stop for review. |

Each phase must be independently safe. Do not enable an unfinished production interaction path: scripted test providers cover the earlier phases, and an unavailable production provider must leave the run parked without granting authority. Parked and owner-rejected outcomes retain the original escalation reason. The user-facing unavailable-answer message explains that limitation without naming an implementation phase.

### Escalation classification and stage transitions

Separate recoverable owner input from terminal failure before creating a question. Only explicit clarification requests, concrete authority-amendment proposals, and an exhausted recoverable rework route qualify. Wrong run identity, altered routing, unauthorized execution, baseline tampering, sandbox violations, or rejected Gate C approval remain terminal. A generic exception is never converted into an approvable question.

For analysis, introduce a dedicated read-only clarification request rather than accepting implementation change_requests wholesale: the [analysis envelope](../../../../packages/conductor/conductor/src/analysis.ts) currently rejects those fields. Reject any request to turn analysis into implementation, grant writing, or acquire execution authority.

| Condition | Proposed durable transition | Next action |
|---|---|---|
| Recoverable escalation at gate X | running/rework → awaiting_owner | Preserve the escalation at X; expose its question after persistence. |
| Valid answer or concrete proposal approved | awaiting_owner → continuation pending | Record the answer and a validated resume plan; reassess the affected gate. |
| Owner rejects | awaiting_owner → aborted | Record owner rejection; dispatch no further specialist. |
| Dialog dismissed, client disconnects, or no provider is available | awaiting_owner remains | Report waiting/unavailable truthfully; grant nothing. |
| Integrity or security breach | terminal escalated | Explain the failure; offer no continuation action. |
| Owner reassessment limit exhausted | terminal escalated | Report the gate, count, limit, and unresolved reason; allow no further resumption. |

Gate history is append-only. Reassessment adds a new gate result and a new child attempt; it never changes the old escalation to pass. Ordinary clarification resumes the originating role at its gate. If an authority amendment invalidates a plan or baseline, the resume plan returns through Strategist and Devil's Advocate before any further implementation; the original escalation remains linked to that repair route.

### Owner actions and authority

The app offers localized labels Godkend, Afvis, and Svar og fortsæt, backed by machine actions approve, reject, and answer_continue. Translated labels and free text never determine authority. A question groups all required clarifications with stable item IDs; the host accepts one complete response atomically, not a partial set of implicit approvals.

Approve is available only for a concrete, previewed proposal that the host can validate. Answer and continue requires answers to every required item, bounded nonempty text, and valid option IDs. If clarification and an amendment are both needed, the response includes the answers and explicit confirmation of the displayed amendment. No default selection, closed dialog, or skipped required question counts as consent.

Retain the original admission unchanged. Store a separate, versioned owner mandate amendment and derive the effective mandate in runtime code. Normalize paths against the admitted workspace, show the exact file/command changes, and validate them against the host's capabilities and mandatory exclusions. An amendment cannot bypass sandbox restrictions or authorize a command unavailable to the host. Ordinary text such as “go ahead” does not expand paths or command IDs.

A valid authority amendment invalidates active execution authorization and any affected baseline. Historical baselines and approvals remain auditable, but cannot authorize new work. Runtime must create a baseline for the effective mandate and obtain a fresh exact Gate C approval before Headsman, Ralph, or any other implementation action can proceed. An owner answer is neither Gate C approval, GO, nor closeout authorization.

Analysis remains analysis: no Headsman, Ralph, Integrator, execution baseline, Gate C approval, or closeout becomes reachable. Its eventual terminal result remains reported. An implementation request arising during analysis requires a separately admitted implementation run.

### Rework accounting

Keep maxReworkPerGate at the configured value, currently 2 in the preset, counting by GateRecord.gate. Owner questions and answers live outside the gate array and consume no automatic rework allowance. They neither reset counters nor create an unbounded retry loop; Ralph's round limit is unchanged.

After a substantive owner response, permit one explicitly linked reassessment of the affected gate, including when its automatic rework allowance is exhausted. This is a new owner-directed assessment, not a replenished budget: another rework result still uses the accumulated count and immediately escalates if it exceeds the limit. Identical already-consumed responses cannot authorize another assessment. If new owner input is needed and its separate reassessment allowance remains, park a new question explaining the remaining obstacle; do not ask or retry automatically without that new obstacle.

Bound owner-directed reassessments separately with the validated Config field maxOwnerReassessmentsPerGate: a positive safe integer, default and preset value 2, checked by both Loader schema and direct configuration resolution. Snapshot the limit in the run's durable budget and validate it on load. Count independently by the originating GateRecord.gate in the owner ledger; consume one allowance together with the accepted response and its resume plan in the same authoritative durable checkpoint/ledger revision in host-turn step 3, never in the temporary RPC reservation of step 2 or when a dialog opens. Duplicate replies, cancellation recovery, restart, and changed process configuration cannot reset or double-charge it.

Allow at most two owner-directed reassessments per gate with the preset. Once both have been consumed, a further required reassessment becomes terminal escalated with the run ID, gate, count, limit, and unresolved reason. An already reserved second assessment remains consumable once; the cap rejects a third assessment. Create no further owner question or resume plan for that gate, and do not let approve or answer_continue reopen it. Rejection remains available for an already pending question, but never grants another assessment. This cap is separate from maxReworkPerGate and from Ralph rounds.

### Persistence and recovery

[The record format](../../../../packages/conductor/conductor/src/state.ts) uses CONDUCTOR_RECORD_FORMAT_VERSION = 4 in P1, rejecting version 3 and other unsupported records with a clear version error and no compatibility layer. #47 and #30 phase 2 build on this version-4 foundation; neither independently claims version 4. Any later format change must allocate the next version from the then-current base.

Keep GateRecord[] exclusively for gate decisions. Add an append-only owner-interaction ledger and a monotonically checked record revision. Each question binds its stable ID to the root session, run ID, originating gate index, stage, exact child attempt, candidate/report hash, mandate revision, required item IDs, reason, and any concrete proposal. Each accepted response records its action, answers, amendment, prior revision, and single-use resume plan. Validate the causal order between the ledger and gate history on load. Never trust client-supplied stage, paths, role, or resume arguments.

This preserves the exact-child [historyOffset contract](../../../../packages/conductor/tool-conductor/src/children.ts). Do not insert questions into run.history or silently attach a later gate result to an earlier child. Both analysis and implementation record validators must understand pending and answered owner interactions, instead of merely relaxing validateResumable.

Questions do not expire automatically: there is no TTL, inactivity deadline, or restart-based expiry. A dismissed dialog, transport timeout, client disconnect, or host restart leaves the durable question pending until an explicit owner response or a recorded run cancellation/supersession. A transport request can end without ending the question.

Browser reconnection reprojects the same pending question. Host restart reconstructs it from the durable ledger with the same question ID and a fresh transport request ID; stale transport replies are rejected. A response is accepted only for the current run/question/revision in the owning root session. Duplicate identical replies return the recorded receipt without another dispatch; conflicting, foreign, or superseded replies fail explicitly. Stale means a non-current transport request, question ID, or record revision, not elapsed time.

Use a completed host-only interaction turn to record an answer before scheduling continuation:

1. Persist the pending question in the Conductor checkpoint and let the original tool turn settle. Publish an answerable card only after the session flush succeeds.
2. Validate the response and reserve the exact pending question in the host controller. The RPC handler queues an opaque host reservation; it does not append session events between turns or turn answer text into tool arguments.
3. Open a normal host-owned follow-up turn. A Conductor-scoped agent/pre-step hook validates the live root agent and reservation, appends the response, mandate amendment, and checkpoint, then returns an empty enter result. The [existing agent loop](../../../../packages/core/agent-loop/src/agent.ts) can complete this turn without model or tool execution.
4. Wait for agent idle and a successful sessions.flush(), rechecking reservation and lifecycle after each await. Only then acknowledge the durable response and schedule the constrained same-run continuation.
5. Consume the resume plan once. The first model tool call, if a model turn is needed, must be conductor for that run, using the host-owned response and stored admission. No generic read/write tools or newly admitted run become available.

The [goal round driver](../../../../packages/goal/goal-round-driver/src/index.ts) provides a lifecycle and flush-barrier pattern, not an existing implementation of owner resumption. Keep the new controller and routing hook scoped to Conductor; do not change instruction precedence or the general agent loop.

[Session repair](../../../../packages/core/session/src/repair.ts) preserves fully written events from interrupted turns and closes interrupted activity. Recovery must reconcile a written response/checkpoint even if the turn was interrupted before the receipt, without applying it twice. Disposal or cancellation never triggers automatic continuation. Preserve an accepted response as continuation pending until the owning session is explicitly resumed.

Do not promise exactly-once external effects across a crash. If dispatch occurred but its durable child identity or settlement is ambiguous, park and report that ambiguity rather than dispatching again. This design assumes one writer per session store: the current in-process reservation is not a cross-process DSH_HOME lock. [Session persistence: lock pr. DSH_HOME (#51)](https://github.com/Biyocon/biyocon-harness/issues/51) is a prerequisite for operation with multiple processes. Until that issue is implemented and verified, exclude a second writer operationally; #37 does not implement the lock.

### Parent routing, UI, and provenance

Extend the [Conductor routing guard](../../../../packages/conductor/tool-conductor/src/mode-routing.ts) with awaiting-owner and reserved-continuation phases. Waiting, completed, rejected, and stopped runs expose no ordinary parent tools. A new user message arriving while a question is pending must not reset the guard into a fresh task; queue it visibly and preserve its contents. Only the host reservation permits resuming the stored run. Workspace instructions, specialist text, model-produced action IDs, and forged inbox source strings confer no reservation.

Add a Conductor-specific typed interaction intent because the [current plan-review presentation](../../../../packages/client/ui-user-questions/src/client/contract/slots.ts) is not the required three-action flow. The card shows run ID, gate, role and attempt, reason, all required questions, and exact proposed authority changes, with textual waiting/accepted/rejected status and accessible controls. Support EN/DA and keyboard use. Refreshing the browser must show the same question and accepted receipt.

Persist typed session events for question created, response recorded, continuation consumed, and terminal rejection, plus the complete Conductor checkpoint. All new owner-interaction events are required-on-read: omit the envelope's ignorable field, never set ignorable: true; ignorable: false is not a valid envelope either. A reader that does not recognize these events must refuse session reconstruction. Define their decoders and transport/SDK coverage in the implementation; adding event types alone need not change the generic session format version.

Regenerate [KNOWN_SESSION_EVENT_TYPES](../../../../packages/core/session/src/known-event-types.ts) and the persistence catalog with pnpm run gen-persistence-catalog, using the [generator](../../../../scripts/gen-persistence-catalog.ts). Check both generated artifacts with pnpm run verify-persistence-catalog, also run by doc-sync; never edit the known-event set by hand. The model-visible continuation context is projected from these same canonical events: exact owner answers, effective mandate revision, evidence references, and any still-required Gate C approval. Never claim that an unanswered question was approved or that specialists ran when they did not.

Keep existing role/attempt/gate display attached to the exact child. Display the owner question separately; resumption creates a new specialist attempt when reassessment is needed. Logs include the interaction IDs and gate decisions, without copying credentials or unrelated private file contents.

### Verification plan and documentation ownership

Extend the real installed-preset examples in [conductor-installed.snapshot.ts](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts), using scripted host answers through the real interaction seam. Tests remain keyless and use an external temporary workspace. The [installed driver](../../../../examples/headless-agent/tests/fixtures/conductor-installed-driver.ts) and [approval fixture](../../../../examples/headless-agent/tests/fixtures/conductor-snapshot-approval.ts) supply starting points; a direct mock of the Conductor engine is insufficient.

- Cover Strategist asking two plan questions and an authority proposal: answer once, retain the run ID, show the original escalation, and reassess the affected gate.
- Cover clarification without new authority, explicit rejection, unavailable interaction provider, dialog dismissal, browser reconnection, and host restart before/after answer persistence and before continuation consumption.
- Verify stale, duplicate, conflicting, wrong-session, wrong-run, wrong-revision, and forged-reservation responses; preserve unrelated queued user messages and deny parent read/write fallback.
- Verify cumulative rework counts and independent maxOwnerReassessmentsPerGate limits: two owner assessments allowed, the third terminally escalated, no counter reset after restart, and no duplicate charge. Also verify exactly one assessment per accepted response, fresh Gate C after mandate change, no writes before approval, and unchanged analysis prohibitions.
- Exercise cancellation at each persistence boundary and ambiguous child dispatch; assert no silent grant, lost accepted response, or automatic duplicate dispatch.
- Check model-visible answers against required-on-read session events and validate both record variants, version-3 rejection, exact child attempts, and historical baseline links. Unknown required events must fail reconstruction; regeneration and verify-persistence-catalog must cover the known-event set. Pending questions must survive elapsed time without automatic expiry.
- Add real browser coverage for EN/DA controls, multiple required answers, refresh, waiting and rejection. Record the eventual GUI PR's GIF from its server on 3090 on a separate assets branch; do not use the owner's app on 10822.
- Update existing model-visible Conductor snapshots and TS/Python SDK expected outputs only where the new events or schemas affect them; run focused tests, typecheck, lint, doc-sync, and the repository pre-push checks during implementation.

The [intake](../../implemented/feature/2026-10-25-conductor-intake-and-report-completion.md), [gate robustness](../../implemented/bug-fix/2026-10-25-conductor-gate-robustness.md), [routing](../../implemented/bug-fix/2026-10-25-conductor-mode-routing.md), [approval seam](../../implemented/feature/2026-07-06-approval-seam.md), and [child status](../../implemented/bug-fix/2026-10-28-conductor-child-role-status.md) notes retain their current rationale and contracts. No implemented note is fully superseded by this partially implemented proposal, so none is archived. Implementation will update and cross-link the partially changed contracts and owning README pairs.

## Alternatives considered

**A: durable parked run with a Conductor-owned controller — recommended.** It supports multiple questions, free text, restart recovery, precise authority binding, and no model activity while the owner is absent. It costs a new interaction intent, ledger, and lifecycle integration, which require explicit race and recovery tests.

**B: keep the conductor call open and await the existing question/approval service.** It needs fewer lifecycle changes and can work while one host process stays alive. Pending maps and a live promise do not provide durable restart recovery; boolean approval also cannot express the required answers. Adding persistence and resumption would converge on A while keeping long-lived tool execution.

**C: return a question as ordinary text and let the parent start a new run.** It avoids a new UI interaction and works in plain chat. It loses same-run identity, makes provenance and authorization ambiguous, and reopens model-directed routing. It does not meet #37.

## Acceptance criteria

- A recoverable Gate B escalation becomes an answerable host-owned question after durable persistence; the owner's response resumes the same run with the original gate and specialist evidence visible.
- All three actions have distinct validated semantics. Required questions cannot be skipped; rejection dispatches nothing, and disconnection grants nothing.
- Only a validated explicit mandate amendment changes effective authority. Every affected execution baseline requires a fresh exact Gate C approval; analysis remains read-only and cannot reach implementation or closeout.
- Gate records, owner interactions, mandate revisions, and child attempts survive restart consistently. Rework and owner reassessment limits remain cumulative and independent; an exhausted owner limit produces terminal escalation with an explanation. Questions have no automatic expiry, and stale or repeated replies cannot cause another continuation.
- Integrity failures and rejected Gate C authorization remain terminal. The parent cannot inspect, write, or start a replacement run while awaiting or processing the owner response.
- Keyless installed-preset snapshots, recovery tests, EN/DA browser checks, and affected SDK fixtures cover the planned contracts; no real API recording is required for the host-scripted scenarios.

## Risks

The main implementation risks are the durable controller boundary, enforcing the separate owner reassessment cap without resetting rework budgets, and the version-4 record change. The three implementation PRs each stop for owner and Claude review; design approval alone does not authorize implementation or merge.

A typed amendment preview is essential: free text that silently expands authority would recreate the original safety problem. Recovery must not claim cross-process locking or exactly-once dispatch that the current host cannot guarantee. Safe multi-process operation depends on the DSH_HOME lock issue linked above; a design assumption is not lock enforcement.

A parked interaction needs clear waiting and cancellation states to avoid appearing complete. Questions and receipts may contain sensitive project information; keep them in the existing session store and avoid unrelated content in events, examples, GIFs, or logs. This design does not add providers, secret storage, or retention policy.
