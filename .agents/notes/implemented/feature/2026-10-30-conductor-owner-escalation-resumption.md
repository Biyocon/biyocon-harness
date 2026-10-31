# Agent Note: Resume Conductor escalations through durable owner questions

Status: implemented

English | [中文](2026-10-30-conductor-owner-escalation-resumption.zh.md)

## Problem

[Issue #37](https://github.com/Biyocon/biyocon-harness/issues/37) describes run CON-2026-4272: Strategist requested authority for six files and clarification of two plan choices, but Gate B escalated without asking the owner. Starting another run loses the connection between the question, specialist evidence and answer. Making every escalation resumable would instead let an answer waive mandatory integrity or authorization checks.

[Gate C](../../../../packages/conductor/tool-conductor/src/index.ts) already obtains host-owned approval for an exact execution baseline. A one-shot permission decision cannot collect required free-text clarification or establish durable same-run resumption. A live RPC promise alone cannot reconstruct the question after a host restart.

## Decision

A recoverable escalation becomes a durable owner question. A Conductor-owned controller collects the owner's complete response through a typed interaction, records it in a model-free host turn, and reserves one constrained continuation of the same run. The shipped preset enables this production path; the [question UI](../../../../packages/client/ui-user-questions/README.md) renders its own Conductor card rather than reusing plan review. The seven specialist roles, purpose-specific routes and gate responsibilities remain unchanged.

### Classification and stage transitions

Only explicit clarification, a concrete host-validatable mandate proposal, and exhausted recoverable report rework qualify for owner input. Identity, routing, unauthorized execution, baseline tampering, sandbox violations, rejected Gate C approval and generic failures remain terminal. An exception's wording never makes it approvable. Analysis accepts only dedicated read-only clarification; it cannot acquire implementation authority.

| Condition | Durable result | Permitted next action |
|---|---|---|
| Recoverable escalation at gate X | `awaiting_owner` | Display the persisted question after successful flush. |
| Complete valid answer or concrete proposal approved | `continuation_pending` | Record one owner-directed reassessment plan. |
| Owner rejects | `aborted` | Retain the rejection; dispatch no further specialist. |
| Dismissal, disconnection or unavailable answerer | Question remains pending | Grant nothing; retain the same durable question. |
| Integrity/security failure or exhausted owner limit | Terminal escalation | Explain the unresolved cause; offer no new continuation. |

Gate history is append-only. Reassessment adds a fresh child attempt and gate result; it never turns an old escalation into a pass. Ordinary clarification returns to its originating role. An authority amendment that invalidates planning returns through Strategist and Devil's Advocate before further implementation. Questions remain outside `GateRecord[]`, preserving the exact-child [history-offset attribution](../../../../packages/conductor/tool-conductor/src/children.ts).

### Actions and authority

The UI maps EN/DA labels to machine actions `approve`, `reject` and `answer_continue`. Labels and answer text never grant authority. A response covers all required item IDs atomically, with bounded nonempty answers and valid machine option IDs. Nothing is selected by default. Closing a panel, skipping a required answer or disconnecting is not consent.

Approve appears only for a concrete host-validated proposal. The card displays its exact before/after allowed paths, excluded paths and quality-command IDs. A response that approves an amendment explicitly confirms that displayed proposal and supplies required clarification. A plain answer cannot silently adopt additional paths or commands.

The original admission stays immutable. Runtime derives effective authority from a separate versioned mandate ledger, checks canonical paths against the admitted workspace and mandatory exclusions, and resolves command IDs through host capabilities. An amendment cannot relax sandbox confinement or authorize an unavailable command. It invalidates active authorization and affected baselines; historical approvals remain evidence, not authority for new work. Headsman, Ralph and implementation effects still require a fresh exact Gate C approval. An owner response is never Gate C approval, GO or closeout.

Analysis retains null execution authorization and cannot reach Headsman, Ralph, Integrator, Gate C approval or closeout. Its accepted result remains `reported`. Implementing recommendations requires a separate implementation run.

### Independent reassessment budget

`maxReworkPerGate` retains its independent gate counts and preset value 2; owner responses neither consume nor reset this automatic allowance. Ralph's round limit is unchanged. A valid owner response permits one linked reassessment even after automatic rework is exhausted, but a subsequent rework still sees the accumulated gate count.

`maxOwnerReassessmentsPerGate` is a positive safe integer validated by Loader and direct configuration resolution, with default/preset 2. The run persists it. Accepting an answer and reserving its resume plan atomically consumes one allowance at the originating gate in the owner ledger; opening a card or reserving an RPC consumes none. A third requested assessment becomes terminal escalation with gate, count, limit and unresolved reason. An already reserved second plan remains consumable once. Restart, duplicate replies and configuration changes do not reset or double-charge either budget.

### Persistence and recovery

`CONDUCTOR_RECORD_FORMAT_VERSION = 4` stores an append-only owner ledger and monotonically validated revision alongside ordinary gates. Version 3 and other unsupported records fail clearly without migration. [#47](https://github.com/Biyocon/biyocon-harness/issues/47) and [#30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30) build on this foundation and must allocate any later version from their current base.

Each question binds its stable ID to root session, run, gate index, stage, exact child attempt, report/hash, mandate revision and required item IDs. Accepted responses bind action, complete answers, optional amendment, prior revision and one-use plan. Both analysis and implementation validators reconstruct this causal history. Client-supplied stage, role, paths or resume arguments cannot replace host-owned data.

Questions have no TTL or automatic expiry. Browser reload reconstructs the same question and accepted/rejected receipt from durable events. Host reconnection binds a fresh transport ID to the same pending question. Replies must match current run, question, revision, transport and exact live root. Identical already-recorded replies return the saved receipt without another dispatch; stale, conflicting, foreign and forged replies fail explicitly.

The host controller preserves this ordering:

1. Save the pending question and flush the Session before presenting an answerable interaction.
2. Validate the response and reserve the exact question. The existing `agent/inbox/spliced` event may precede the host turn, but contains only an opaque reservation and neutral plugin-authored text. Answers, selections, mandate changes and checkpoints never enter that queue. Controller state, not message text or source strings, validates ownership and single use.
3. The Conductor-scoped `agent/pre-step` hook records response, mandate change and checkpoint in a normal host-owned turn. Only after that checkpoint flush succeeds does it append the required `conductor/owner-response-acknowledged` marker certifying the prior response's durability, then return empty input so no model/tool step runs. This marker remains inside the same host turn; it grants no continuation by itself.
4. After agent idle and successful `sessions.flush()`, acknowledge the durable response and schedule only its constrained continuation. Recheck liveness and cancellation across asynchronous boundaries.
5. Consume the stored plan once before specialist dispatch. If a model step is needed, its first tool must be `conductor` for the reserved run. Its intentionally logged plugin context projects the durable answer, effective mandate and any still-required Gate C approval.

No general agent-loop or workspace-instruction precedence changes are involved. A user/model copying reservation text cannot create a continuation. New user messages while waiting remain visibly queued; ordinary parent tools stay denied during waiting, continuation reservation and completed/stopped results.

Recovery reconciles fully written required owner events with an interrupted checkpoint without reapplying answers. Queued markers lacking a durable answer are neutralized and leave the question pending. A saved answer with an unconsumed plan remains explicitly recoverable. Cancellation and disposal never automatically continue. If dispatch may have occurred but durable child identity/settlement is ambiguous, the run stays parked rather than dispatching again.

A durable accepted answer whose plan is still unconsumed remains parked after restart; agent creation never dispatches it automatically. The host first reconciles and flushes any missing acknowledgement in a model-free host turn, then offers a typed `conductor-owner` card with `mode: continuation`. It shows the saved acceptance and prior question without editable answers, authority or proposal controls. The only action is an explicit `answer_continue` with empty answers and no proposal hash. A fresh private transport reservation validates exact root, run, question, current answer revision and unconsumed plan before calling the existing `resumePending` path. This consumes no second answer or owner reassessment allowance; repeated consumption and stale/foreign transports fail.

Five required-on-read session events record question creation, response, response acknowledgement, continuation consumption and terminal rejection. The four ledger facts precede their complete checkpoints; the acknowledgement follows a successful response-checkpoint flush inside the host answer turn. None carries `ignorable`. Decoders validate ledger and transport identities; SDK projections cover the events. `pnpm run gen-persistence-catalog` owns `KNOWN_SESSION_EVENT_TYPES` and the persistence catalog, checked by `verify-persistence-catalog`. Model-visible continuation context is separately logged and reconstructable.

This is an in-process reservation, not an exactly-once external-effect guarantee or cross-process store lock. [Session persistence: lock pr. DSH_HOME (#51)](https://github.com/Biyocon/biyocon-harness/issues/51) remains necessary before multiple processes share one home. Each app/test server uses an isolated store until that lock exists.

### Parent routing, UI and provenance

The typed Conductor card shows run ID, gate, runtime role and attempt, cause, every required question and exact proposal changes. It has textual waiting/accepted/rejected states, EN/DA chrome and native keyboard-accessible controls. Durable conversation rendering preserves the question and receipt after reload. A raw response/rejection event is not enough to show an accepted/rejected receipt: those events can stream before flush. The UI requires the matching post-flush acknowledgement marker; without it, even a cancelled transport leaves the visible status waiting and withholds the answer text. Unsubmitted form drafts are local UI state, not durable consent.

Responses go only through the production provider and P2 controller. UI text does not select a stage, authorize a tool or supply model arguments. Existing role/attempt/gate rows remain attached to exact children, while questions are separate interactions. Resumption may create another specialist attempt without overwriting the earlier result.

The [intake](2026-10-25-conductor-intake-and-report-completion.md), [gate robustness](../bug-fix/2026-10-25-conductor-gate-robustness.md), [routing](../bug-fix/2026-10-25-conductor-mode-routing.md), [approval seam](2026-07-06-approval-seam.md) and [child status](../bug-fix/2026-10-28-conductor-child-role-status.md) decisions remain active and cross-linked for their independent contracts; none is fully superseded or archived.

## Verification

The real [installed-preset examples](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts) exercise scripted host answers through the interaction service in external workspaces, not a mocked Conductor engine. They pin same-run clarification/amendment/rejection, required answers, parent tool denial, model-visible answer projection and pending/unavailable states. Domain/controller tests exercise independent counters, exact transport binding, duplicate receipts, forged reservations, cancellation at persistence boundaries, interrupted writes, acknowledged-but-unconsumed restart recovery without automatic dispatch, single-use explicit continuation without a second budget charge, and ambiguous consumed dispatch. Required-on-read event decoders, catalog freshness and TS/Python SDK fixtures retain their own coverage.

The real web lane covers EN/DA controls, multiple mandatory answers, rejection, waiting, reload before/after response and keyboard use with keyless replay. Web goldens come from runnable scenarios. The GUI demonstration uses an isolated branch server/home on port 3090 and a separate assets branch; it does not touch the owner's app on 10822 or expose private task data.

## Alternatives considered

**Keep a durable parked run with a Conductor-owned controller.** Chosen because free text, multiple questions, restart recovery and exact authority binding require durable state and an explicitly owned continuation. It costs a typed interaction, ledger and lifecycle tests.

**Keep the original tool call open on the existing approval/question promise.** Rejected because live pending maps cannot reconstruct host-restart state, and boolean approval cannot express complete clarification. Adding durable resumption would converge on the chosen controller while retaining a long-lived tool call.

**Return ordinary question text and let the parent start another run.** Rejected because it loses same-run evidence, makes authorization ambiguous and reopens model-directed routing.

## Consequences

The owner can answer a recoverable escalation in the app without discarding its run or specialist evidence. Production answering completes the three-phase delivery of #37; it does not authorize merge, release or implementation outside an approved baseline. Waiting consumes no model work, while each accepted reassessment adds bounded specialist work.

Question/answer history may contain sensitive project information and remains in the existing Session store; no new model provider, secret storage or retention policy is introduced. Clear states and exact previews prevent a parked run from looking complete or free text from silently expanding authority. Unsupported old runs need fresh admission, and cross-process operation still depends on #51.
