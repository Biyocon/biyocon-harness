# Agent Note: One Conductor format for evidence, verification and budgets

Status: proposed

English | [中文](2026-11-11-conductor-v6-evidence-verification-and-budgets.zh.md)

## Problem

[#75 phase 2](https://github.com/Biyocon/biyocon-harness/issues/75), [#30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30) and [#58 phase B](https://github.com/Biyocon/biyocon-harness/issues/58) need required durable fields. Independent versions would let identical format numbers describe incompatible records. Hash-valid citations alone do not establish factual support, a Git commit does not identify dirty work, and limits without per-call accounting cannot bound concurrent children or disclose uncertain consumption.

## Proposal

### Ownership and allocation

Codex maintains the single schema and version allocation; Claude reviews and the owner merges. Reserve the name v6 for this complete proposal, not an implemented format. Recheck merged master before implementation and before merge; if that number is occupied, stop for coordinated reallocation. No runtime changes, format bump or migration belong to this design PR. Keep rc.7 and the one-way dependency from Conductor to generic services.

This note owns the combined future fields and acceptance rules. The [claim design](2026-11-05-conductor-analysis-claim-verification.md), [Detective design](2026-11-05-conductor-detective-evidence-budget.md), [intake decision](../../implemented/feature/2026-10-25-conductor-intake-and-report-completion.md) and [child-limit decision](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md) retain their independent rationale and delivered behavior. #75 phase 1 and #58 phase A require no v6. Their unmerged implementation PRs are dependencies to review, not assumed master behavior.

### Required record groups

Keep the existing checkpoint event and session envelope. Each v6 run contains these required, validated groups; purpose-specific data uses explicit discriminants rather than ambiguous absent fields.

| Group | Required information |
|---|---|
| `admission` | Immutable purpose `implementation`, `analysis` or `verification`; entry; acceptance criteria; captured sources; host-selected evidence mode; resolved limits. |
| `candidateIdentities` | Append-only host-observed Git/manifest identities, ordered file entries, omissions, scope and digest; active candidate ID, or explicit `none` for pure analysis. |
| `reportVersions` | Exact candidate content/hash, quote claims and occurrences, challenge/audit hashes and host presentation. |
| `budgetLedger` | Limits, unique reservations, dispatch and usage provenance, actual charges, unresolved reservations and terminal reason. |
| `inspectionLedger` | Child/attempt, source identity, returned spans/pages, observed changes, selection and disclosed omissions. |
| `final` | Report/verification/implementation result, or terminal `incomplete` with reason and remaining unverified scope. |

Use branded IDs for run, child, candidate, claim, inspection and call identity. Canonical serialization specifies UTF-8, LF for record serialization only, sorted object keys and retained array order. Source bytes and report quotes are never normalized. Hash records with a domain/version prefix; child/audit/presentation hashes include the run and exact candidate/source identities. Parsers verify references, uniqueness, acyclicity, counters and reachable transitions, not just individual field types. Bound counts, bytes and aggregate checkpoint size through validated Config; reject admission or end explicitly before an oversized checkpoint, never silently drop accounting.

Analysis stores the claim-bearing report history; verification stores candidate-bound audit/verdict history; implementation retains its execution-baseline history. Non-applicable groups carry `not_applicable`, not fabricated evidence or approvals. Only analysis selects the two claim-evidence modes. Verification adds terminal status/stage `verified` / `verification-complete`; every purpose can end `incomplete` / `incomplete`. Keep existing implementation and reported terminals. Resume permits only valid nonterminal transitions; terminal results are immutable.

### Claims and honest report presentation

Use the approved exact-quote inventory: unique claim ID, nonempty exact substring, occurrence index and candidate hash. Auditor independently reads the whole candidate for missing material claims and downgraded materiality; substring matching proves identity only. Each submitted claim receives `source_verified` with admitted source/hash/lines, `derived` with a nonempty acyclic chain of supported premises and inference, or `unverified` with the missing evidence. Reject stale identities, nonexistent occurrences, incomplete assessments and unsupported premises. `current-request`, model memory, bare URLs and unadmitted discoveries never establish source verification, directly or through derivation.

The host selects `model_knowledge` only when admission contains no evidence beyond `current-request`. Every analysis child, including critic, Auditor and Arbiter, receives only the structured-output capability; deny file/image/search/web tools and workspace/source injection. Trusted role instructions and the question remain. Acceptance may contain unverified material claims but the entire report carries **“Bygger på modelviden, ikke verificeret mod kilder” / “Based on model knowledge, not source-verified”**. New sources require a new authorized intake.

Any admitted source selects `source_backed`, including irrelevant sources. Acceptance rejects every material unverified claim; incidental unverified claims cannot support conclusions and receive **“Unverified / Ikke verificeret”** at each exact occurrence. Host rendering handles overlapping occurrences deterministically and binds the full labelled text to candidate/audit hashes. Auditor judges meaning and source support; Arbiter checks the exact candidate, challenge, audit and permitted acceptance. Use `revise` for repair within admitted evidence and `blocked` for essential inaccessible verification. Embedded source/report instructions cannot choose mode or authorize tools.

The canonical final response is the host-rendered Conductor tool result containing the labelled report, not an extra model paraphrase. Use the existing execution-owned `concludeTurn()` marker for accepted reports; a Conductor-scoped request guard refuses a subsequent parent model call for that completed task. Do not discard racing steering: preserve it for an explicit new user task or show the refusal. Terminal presentation must work in the assembled shipped preset, including other plugins that defer context. UI, copy/export and Conductor SDK adapters expose the same canonical text and hash. Raw candidate content remains an explicitly unaccepted draft; it must not masquerade as the final report. If the existing terminal-tool projection cannot satisfy an adapter, resolve that gap in review before adding a generic core mechanism.

Persist unavailable-tool denials per child attempt across resume, across names/arguments. A positive integer Config limit, initially two, permits one logged correction and then visibly fails the attempt; no automatic retry or capability expansion.

### Verification entry and exact candidate identity

Allow `purpose: verification`, `entry: auditor` only with explicit scope, nonempty criteria, captured supplied work and a complete host-observed candidate identity. Verification is read-only and follows Auditor → Arbiter; it does not invent an execution approval, Integrator delivery or GO. Record reached bypasses with supplied-material references and reasons. Analysis retains its mandatory independent critic; implementation retains all existing execution gates.

For Git, identify HEAD plus an ordered manifest of the selected tracked and untracked files, type/mode, byte length and SHA-256, including deletions and the saved scope/exclusion policy. A dirty/status string or HEAD alone is insufficient. For non-Git, identify an explicit root-relative manifest of the entire declared verification scope and the same file facts. Reject escapes, symlink traversal, unreadable files, ambiguous case collisions and unstable reads; record exclusions and never imply whole-workspace coverage. File hashes support binary identity without promising text extraction. Persist enough source/candidate material for the declared verification and replay within admission limits; absent content is an explicit verification limitation, not reconstructed from changed files.

Observe identity before dispatch and immediately before accepting verification or using quality evidence. Any change invalidates the audit and requires a new candidate version and fresh verification. Repeated changes or an uninspectable scope end `incomplete`. Bind quality-command evidence to the candidate digest, command policy and actual execution result; a failed or absent check cannot become a pass. Read-only verification may execute only existing host-approved quality operations whose policy permits that scope; source mutation invalidates the candidate.

Rework that only repairs an audit repeats Auditor on the same identity. Implementation/scope defects may route to earlier read-only planning under the deciding gate's retained rework allowance, but never enter Headsman, Ralph or Integrator in this verification run. Writing requires a new implementation run, an exact host-observed baseline and the owner's Gate C approval. Existing approvals cannot transfer to a changed digest or a new run. `verified` means the stated scope and criteria were checked, not that the software or every claim is universally correct.

### Reservation before each actual model call

Persist positive-safe-integer per-request total input, reasoning-inclusive output, per-child cumulative output and run total-token allowances at admission. The run budget covers all Conductor-owned specialist, critic, Auditor, Arbiter, rework and nested child model calls, attributed through trusted child identity. Parent calls that classify intake before run creation or serve unrelated tasks are reported separately and are outside that ceiling. Reject unattributed descendant dispatch; do not call this a whole-account bill limit.

Bind policy to the reserved child session ID before child activation, through host-scoped listeners; a label or model argument cannot establish membership. A provider must support reserved identity, observable per-attempt preflight/usage and inclusive output enforcement. Reject remote or nested dispatch that cannot meet those requirements before it starts; do not repurpose the tool-contribution callback as an undocumented lifecycle hook.

An input bound includes system/persona, schemas, messages/history and provider framing. An exact route must supply a defensible conservative input-token upper bound before dispatch and enforce output including reasoning; unsupported routes fail before spending. A characters-per-token estimate cannot support a hard input cap. The generic preflight must receive the final frozen request before logging its effective header. Existing `agent/request` sees config but not the assembled messages; `llm/stream` sees messages after header logging. Neither alone may silently rewrite the logged request. Review a small generic prepared-request hook plus route-owned input-bound capability; core types must not import Conductor.

Provider feasibility is a prerequisite, not established support: the [official token guide](https://api-docs.deepseek.com/quick_start/token_usage/), checked 2026-11-11, offers approximate character ratios and an offline tokenizer demo, while actual usage comes from the response. That does not establish a bound for a complete framed request on the exact deployed route. Prove that capability before implementing budget enforcement; otherwise return the limitation to design review rather than advertise a hard input guarantee.

Under the host's per-run serialization lock, allocate a unique call ID and durable reservation, then flush before any provider dispatch. A call ID binds child session, turn, step and attempt ordinal; a retry at the same step gets another ordinal. Reserve `I` input tokens plus `O = min(request output limit, child output remaining, run remaining − I)`. No positive `O` means no dispatch. Atomicity is local to the owning process; #51's independently reviewed single-writer lock remains required for cross-process safety.

Persist transitions `reserved` → `dispatched` → `settled`, with explicit `unknown` on uncertainty. The dispatcher cannot invoke the provider until reservation persistence succeeds. Reconcile reported usage once against call ID and logged source positions; identical replay is a no-op, conflicting duplicate usage is an error. Canonical `TokenUsage` has disjoint uncached input/cache-read/cache-write fields; sum them for input, and add inclusive output once. Reasoning is a subset, never another charge. Missing cache fields remain unreported; an adapter must attest whether reported total input is complete before unused reservation can be released. Preserve reported usage separately from conservative charges.

Unknown/malformed usage, crash with an unresolved reservation, missing settlement evidence or adapter overrun consumes at least the reservation, discloses any larger observed usage and ends the run `incomplete`. No automatic redispatch, refund from assumed zero, budget reset on owner continuation or reuse across a new call. Provider/network retries are disabled unless every actual attempt has its own durable reservation and usage; middleware retries cannot hide behind one ledger entry. The existing child output limit and critic allowance reference these same settled calls rather than adding output twice. Replay reconstructs remaining child output from settled usage and conservatively charged unresolved calls before resume.

### Inspection and incomplete results

Record successful returned ranges from admitted captures using material ID/hash, exact line bounds and tool-result provenance. Search pages record immutable snapshot ID/digest, cursor and shown/total counts; returned hits are search observations, not proof that complete file bodies were read. Workspace reads carry an observed candidate digest/version or are explicitly provisional. Errors, truncated/unreturned pages and uninspected files do not count as inspected. Model selection explanations are attributed to the model, not invented as host facts. Auditor retains access to complete admitted evidence subject to the same run budget.

Terminal `incomplete` records reason, actual/conservatively charged/reserved/limit totals and specific omitted scope. It cannot become a complete producer candidate, accepted report, GO or resume within the same spent run. A fresh owner-requested run has a new ID and explicit new allowance; it never rewrites the old result. UI and timeline show **“Ufuldstændig — ikke færdigverificeret / Incomplete — verification unfinished”**, with counts and omissions. Budget caps control exposure; they do not establish price savings. The two public studies in [#106](https://github.com/Biyocon/biyocon-harness/pull/106) do not establish stable phase-A net savings; no budget acceptance criterion may conceal a failed or expensive trial.

### Delivery and package ownership

Implement shared state/parsing/hash/accounting in `packages/conductor/conductor`, dispatch/guards/material capture in `packages/conductor/tool-conductor`, trusted role resources/presets in Conductor, and presentation in its UI plugin. Record any generic preflight/input-bound exception in the [core dependency inventory](../architecture/2026-11-05-conductor-core-dependencies.md), with files, rationale and actual PR number. Keep core Conductor-free. SDK work projects existing generic checkpoint/tool results; any new event or loop lifecycle requires both SDK expected outputs and catalog regeneration.

Use one integration branch with reviewable commits. Merge no partial interpretation of v6: either one complete PR, or individually safe generic prerequisite PRs followed by one complete format integration PR. v5/older Conductor records become unavailable without migration, while their chat history remains openable through the #79 availability handling. Saved records are validated on use; opening/replay isolates failures without falling back to a guessed run. Add no new required session event types solely for these fields. Unknown unrelated required session events retain the generic strict behavior.

## Alternatives considered

**Separate v6 bumps per issue.** Rejected because the owner requires one schema owner and one reviewed meaning. Feature flags must not reinterpret persisted v6 fields.

**Full non-overlapping report segmentation.** Retains character coverage but not semantic completeness; exact quote claims reduce structural overhead while keeping Auditor's independent omission check. The earlier 520–600 versus 800–1,200 producer-token estimates remain illustrative, not measurements or savings promises.

**Best-effort budgets or history pruning.** Character estimates, volatile counters and post-dispatch reservations cannot enforce the proposed allowance. Pruning stays disabled unless a separate public real-model price study includes lost cache hits and recall costs. Source bounding and cheaper-model evaluation retain their separate scope.

**Reuse Gate C authority for verification repairs.** Rejected: verifying supplied work never authorizes new writes. Starting a new implementation run preserves explicit owner control.

## Acceptance criteria

- Parser/tamper tests cover every required group, impossible transitions, stale/foreign identities, oversized data, malformed reservation arithmetic and v5/unavailable history isolation. All fixtures are synthetic.
- Claims: missing/duplicate/overlapping quotes, omitted material assertions, cyclic premises, current-request laundering, wrong source spans, mode switching, embedded directives and missing/wrong labels fail appropriately. Test source-backed strictness and source-free acceptance through actual producer/critic/Auditor/Arbiter composition.
- Verification: Git dirty/untracked/deleted and non-Git candidates, changes during capture/check/audit, cold resume, read-only repair and denied write/GO/approval transfer use real filesystem and approved quality paths.
- Accounting: concurrent reservations, retry ordinals, crash before/after dispatch or settlement, duplicate/conflicting usage, absent cache fields, reasoning inclusion, provider overrun, descendant attribution and exhausted rework/continuation never create free calls or double charges. Prove unsupported providers fail before dispatch.
- Keyless runnable examples cover labelled reports, terminal-tool rendering with deferred context/steering, verification entry, rework/resume, and incomplete output. Both SDK projections and shipped-preset GUI/GIF evidence must preserve canonical labels, counts and unavailable history. Real-model public trials report full price and quality, including failures; owner app/home remain untouched.

## Risks

Semantic omission/materiality/source support remain model judgments. Conservative preflight can reject useful work, and a misbehaving provider can overrun one call; the ledger exposes that rather than promising prepaid invoice control. Full checkpoints grow with histories and require admission/aggregate limits. Cross-process writers remain unsafe until #51 is implemented. The new generic request hook and input-bound capability are planned dependencies requiring separate scrutiny, not permission to put Conductor logic in the core. Implementation starts only after this combined design is reviewed and the owner orders it.
