# Agent Note: One Conductor format for evidence, verification and budgets

Status: proposed

English | [中文](2026-11-11-conductor-v6-evidence-verification-and-budgets.zh.md)

## Problem

[#75 phase 2](https://github.com/Biyocon/biyocon-harness/issues/75), [#30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30) and [#58 phase B](https://github.com/Biyocon/biyocon-harness/issues/58) need required durable fields. Independent versions would let identical format numbers describe incompatible records. Hash-valid citations alone do not establish factual support, a Git commit does not identify dirty work, and limits without per-call accounting cannot bound concurrent children or disclose uncertain consumption.

## Proposal

### Ownership and allocation

Codex maintains the single schema and version allocation; Claude reviews and the owner merges. v6 is a working name, not a frozen schema or allocated release number. Provider-feasibility gate G0 below comes first: do not freeze the format or start v6 implementation until its evidence is reviewed. Recheck merged master before allocation, implementation and merge; an occupied number requires coordinated reallocation. This design PR adds no runtime, format bump or migration. Keep rc.7 and core free of Conductor dependencies.

This note owns the combined future fields and acceptance rules. The [claim design](2026-11-05-conductor-analysis-claim-verification.md), [Detective design](2026-11-05-conductor-detective-evidence-budget.md), [intake decision](../../implemented/feature/2026-10-25-conductor-intake-and-report-completion.md) and [child-limit decision](../../implemented/architecture/2026-11-02-reserved-child-identity-and-output-token-limit.md) retain their independent rationale and delivered behavior. #75 phase 1 and #58 phase A require no v6. Their unmerged implementations are not assumed master behavior. The owner holds #100, does not accept #105 as a price optimization, and preserves both #106 studies; v6 must not silently require those merges.

### First gate: provider feasibility before schema freeze

Evaluate both candidate bounds against reported usage on each exact route: **(a)** UTF-8 bytes of the complete serialized model request plus a measured chat-template margin; **(b)** a bundled offline tokenizer plus a measured margin. For a route proven to use byte-level BPE, ordinary tokens represent at least one input byte; this premise alone does not cover special tokens, hidden templates, normalization, tools or multimodal conversion. Candidate (a) must count all model-visible serialized fields and cover hidden framing. Candidate (b) must pin tokenizer/model/template versions, provenance and redistribution rights; a different model's tokenizer or message text alone is insufficient.

Pin endpoint, adapter/provider implementation, actual model revision, reasoning/tool encoding and template. Compare both bounds with complete reported input, including cache-read, for Unicode, escaped JSON, tools/history, long contexts and retries. Record worst undercount, chosen margin, assumptions and rejected inputs; recheck on route changes. Empirical headroom is not universal proof. The [official token guide](https://api-docs.deepseek.com/quick_start/token_usage/) supplies estimates and an offline demo, not a complete-route guarantee.

The retained 606 calls can inform offline calibration, but do not establish both candidates on a pinned current route. **No new paid model call without the owner's explicit approval.** G0 needs reviewed bound/usage results for both candidates, a selected conservative bound, per-attempt transport observability/output enforcement and keyless retry/refusal tests. Otherwise return the limitation to review: no schema freeze, v6 bump or hard-budget claim. This revision performs only the offline checkpoint-size estimate below.

### Required record groups

Keep the existing checkpoint event and session envelope. Each v6 run contains these required, validated groups; purpose-specific data uses explicit discriminants rather than ambiguous absent fields.

| Group | Required information |
|---|---|
| `admission` | Immutable purpose `implementation`, `analysis` or `verification`; entry; acceptance criteria; captured sources; initial host-selected evidence mode; resolved limits. |
| `candidateIdentities` | Append-only host-observed Git/manifest identities, ordered file entries, omissions, scope and digest; active candidate ID, or explicit `none` for pure analysis. |
| `reportVersions` | Exact candidate content/hash, quote claims/occurrences, challenge/audit hashes, append-only evidence-mode decisions and host presentation. |
| `budgetLedger` | Limits, unique reservations, dispatch and usage provenance, actual charges, unresolved reservations and terminal reason. |
| `inspectionLedger` | Child/attempt, source identity, returned spans/pages, observed changes, selection and disclosed omissions. |
| `final` | Report/verification/implementation result, or terminal `incomplete` with reason and remaining unverified scope. |

Use branded IDs for run, child, candidate, claim, inspection and call identity. Canonical serialization specifies UTF-8, LF for record serialization only, sorted object keys and retained array order. Source bytes and report quotes are never normalized. Hash records with a domain/version prefix; child/audit/presentation hashes include the run and exact candidate/source identities. Parsers verify references, uniqueness, acyclicity, counters and reachable transitions, not just individual field types. Bound counts, bytes and aggregate checkpoint size through validated Config; reject admission or end explicitly before an oversized checkpoint, never silently drop accounting.

Analysis stores the claim-bearing report history; verification stores candidate-bound audit/verdict history; implementation retains its execution-baseline history. Non-applicable groups carry `not_applicable`, not fabricated evidence or approvals. Only analysis selects the two claim-evidence modes. Verification adds terminal status/stage `verified` / `verification-complete`; every purpose can end `incomplete` / `incomplete`. Keep existing implementation and reported terminals. Resume permits only valid nonterminal transitions; terminal results are immutable.

### Claims and honest report presentation

Use the approved exact-quote inventory: unique claim ID, nonempty exact substring, occurrence index and candidate hash. Auditor independently reads the whole candidate for missing material claims and downgraded materiality; substring matching proves identity only. Each submitted claim receives `source_verified` with admitted source/hash/lines, `derived` with a nonempty acyclic chain of supported premises and inference, or `unverified` with the missing evidence. Reject stale identities, nonexistent occurrences, incomplete assessments and unsupported premises. `current-request`, model memory, bare URLs and unadmitted discoveries never establish source verification, directly or through derivation.

The host initially selects `model_knowledge` when admission has no evidence beyond `current-request`. Children dispatched in this mode, including critic, Auditor and Arbiter, receive only structured output; deny file/image/search/web tools and workspace/source-content injection. Retain trusted role instructions and the question. Acceptance may contain unverified material claims, but the whole report carries **“Bygger på modelviden, ikke verificeret mod kilder” / “Based on model knowledge, not source-verified”** and is never called documented or factually verified. New sources require new authorized intake.

Admitted sources initially select `source_backed`. The owner's D1 decision permits this exception: **when Auditor judges an admitted source irrelevant to the requested analysis, the report falls back to labelled `model_knowledge`, not `blocked` merely because of that irrelevance.** Before acceptance persist an append-only decision bound to Auditor's trusted child/attempt, candidate/audit hash, source ID/hash and relevance reason. Preserve the capture and earlier authorized accesses; do not pretend no source was admitted. Show the reason and mode change visibly beside the mandatory whole-report EN/DA label. The resulting candidate receives no source-verification credit; earlier assessments are history, not accepted `source_verified` claims. Later children use the restricted model-knowledge view without source excerpts injected from prior reports. Necessary revision does not reset spent budgets or rework allowances; exhausted budgets can still produce `incomplete`.

While `source_backed` remains effective, acceptance rejects every material unverified claim. Incidental unverified claims cannot support conclusions and receive **“Unverified / Ikke verificeret”** at each occurrence. Host rendering handles overlaps deterministically and binds labelled text to candidate/audit/mode-decision hashes. Auditor judges relevance, materiality and support; Arbiter checks the exact candidate, challenge, audit and mode decision. Use `revise` for repair within relevant admitted evidence and `blocked` for essential inaccessible verification, not D1's irrelevant-source fallback. Producer/report/source instructions or a bare request cannot choose or forge a downgrade.

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

An input bound covers the complete frozen route request, not just text. Put a generic per-actual-attempt preflight **below [dsh-llm-retry](../../../../packages/llm/llm-retry/src/index.ts)**, inside each adapter after route conversion and immediately before transport. For [DeepSeek](../../../../packages/llm/llm-deepseek/src/adapter.ts), it runs after final payload construction and before every `fetch`; for [pi-ai](../../../../packages/llm/llm-pi-ai/src/adapter.ts), it must reach every actual provider request beneath lazy `streamSimple`, including SDK-internal retries. A `streamSimple` wrapper alone is insufficient if serialization/every attempt cannot be observed; that route fails G0.

The callback finalizes the cap, freezes the exact request, reserves/flushes and logs non-secret effective attempt parameters plus request/input references and serializer/hash provenance before transport. Never silently rewrite a previously logged effective request. Propose generic per-attempt request metadata with an ignorable envelope for old chat readers, but mandatory referenced evidence for v6 budget replay; declare its event type, regenerate catalogs and update both SDK projections in the prerequisite PR. Existing `agent/request` config and outer `llm/stream` are not substitutes. Reconstruct request text from logged inputs plus explicit effective fields; never log authorization headers or keys. G0 proves logging and the bound describe the same frozen request.

Start budgeted routes with provider `retryPolicy.maxRetries=0`, reject `always`, and disable SDK/network retries, including pi-ai provider options. Other retry plugins are allowed only when the transport callback creates a fresh attempt ordinal, reservation, effective request record and settlement for every actual send. dsh-llm-retry recovery cannot bypass it. Unknown dispatched usage ends `incomplete`, not another hidden retry. Keyless fake-transport tests count actual sends through plugin/SDK retry paths; configuration names alone do not prove retries are off. Core hooks never import Conductor.

Under the host's per-run serialization lock, allocate a unique call ID and durable reservation, then flush before any provider dispatch. A call ID binds child session, turn, step and attempt ordinal; a retry at the same step gets another ordinal. Reserve `I` input tokens plus `O = min(request output limit, child output remaining, run remaining − I)`. No positive `O` means no dispatch. Atomicity is local to the owning process; #51's independently reviewed single-writer lock remains required for cross-process safety.

Persist an atomic reservation plus `dispatch_authorized` intent in one preflight checkpoint, then `settled` or explicit `unknown` in a second checkpoint. Authorization is not proof of remote receipt. A crash after reservation but before transport stays conservatively unresolved; absence of a separate dispatched marker never permits refund. The dispatcher cannot invoke the provider until the parent reservation and effective-attempt metadata both flush; failure between those session writes still consumes the unresolved reservation. Reconcile reported usage once against call ID and logged source positions; identical replay is a no-op, conflicting duplicate usage is an error. Canonical `TokenUsage` has disjoint uncached input/cache-read/cache-write fields; sum them for input, and add inclusive output once. Reasoning is a subset, never another charge. Missing cache fields remain unreported; an adapter must attest whether reported total input is complete before unused reservation can be released. Preserve reported usage separately from conservative charges.

Unknown/malformed usage, crash with an unresolved reservation, missing settlement evidence or adapter overrun consumes at least the reservation, discloses any larger observed usage and ends the run `incomplete`. No automatic redispatch, refund from assumed zero, budget reset on owner continuation or reuse across a new call. Provider/network retries are disabled unless every actual attempt has its own durable reservation and usage; middleware retries cannot hide behind one ledger entry. The existing child output limit and critic allowance reference these same settled calls rather than adding output twice. Replay reconstructs remaining child output from settled usage and conservatively charged unresolved calls before resume.

### Checkpoint growth and selected limits

The [content-free size estimate](2026-11-11-conductor-v6-checkpoint-estimate.json) uses the preserved [initial](https://github.com/Biyocon/biyocon-harness/blob/5b3e4d7c8fd7ddfc5f84c6d8826c0e9bcd2f3fe5/scripts/conductor-cost/results/2026-11-11.json) and [follow-up](https://github.com/Biyocon/biyocon-harness/blob/5b3e4d7c8fd7ddfc5f84c6d8826c0e9bcd2f3fe5/scripts/conductor-cost/results/2026-11-11-guidance.json) studies: 606 calls, 47 parent calls outside the run ledger, 559 budget entries, 1,116 filesystem-result entries, 145 existing workflow checkpoints and 23 actual runs among 24 attempts. Error results retain metadata but establish no inspection.

This offline simulation uses hypothetical metadata/opaque IDs and the largest observed v5 record per run for every simulated checkpoint. Reported token counts size numeric fields only, not proven reservations. Sources and raw public-experiment sessions remain local and unchanged. Node 24.13.0 compresses each flushed checkpoint as an independent checksummed default-level Zstandard frame, matching backend append framing without a cross-frame dictionary.

| Metric across the preserved studies | Estimate |
|---|---:|
| Settled budget entry, UTF-8 JSON | 684–703 bytes; mean 695 |
| Inspection entry, UTF-8 JSON | 446–499 bytes; mean 482 |
| Three checkpoints/call plus workflow: count / raw / zstd | 1,822 / 372,710,753 / 39,108,844 bytes |
| Selected two checkpoints/call plus workflow: count / raw / zstd | 1,263 / 259,851,095 / 27,342,097 bytes |
| Selected checkpoints per actual run | 27–101; mean 54.91 |
| Selected zstd checkpoint bytes per actual run | 357,020–3,565,781; mean 1,188,787 |
| Largest simulated encoded checkpoint | 424,138 bytes |

Select two mandatory full checkpoints per actual call: preflight reservation/dispatch intent and final settlement. Coalesce inspection updates from existing tool-result provenance into the next preflight/workflow checkpoint, never per token, usage chunk or tool result. Retain the 145 workflow checkpoints in the estimate; do not weaken crash accounting. This gives 26.08 MiB zstd checkpoint bytes across 23 runs, not total future v6 disk use. Other new claim/identity fields, child transcripts and generic attempt events are excluded; allow at most 2 KiB attempt metadata separately. Compression and future payloads can differ.

Propose validated, admission-persisted Config defaults: 256 calls/run, 4,096 inspection entries, 2 KiB per ledger entry, 512 KiB combined ledgers/checkpoint, 8 MiB per complete encoded checkpoint envelope and 64 MiB cumulative uncompressed checkpoint bytes/run. Measured maxima under this model are 74,536 combined ledger bytes and 39,125,379 cumulative bytes/run. Reserve capacity for settlement and terminal incomplete before dispatch; reaching any limit ends explicitly before more spending, without dropping/pruning ledger history. These proposed storage/exposure limits are not price savings or frozen v6 constants; G0 and design review must confirm them against the complete schema.

### Inspection and incomplete results

Record successful returned ranges from admitted captures using material ID/hash, exact line bounds and tool-result provenance. Search pages record immutable snapshot ID/digest, cursor and shown/total counts; returned hits are search observations, not proof that complete file bodies were read. Workspace reads carry an observed candidate digest/version or are explicitly provisional. Errors, truncated/unreturned pages and uninspected files do not count as inspected. Model selection explanations are attributed to the model, not invented as host facts. Auditor retains access to complete admitted evidence subject to the same run budget.

Terminal `incomplete` records reason, actual/conservatively charged/reserved/limit totals and specific omitted scope. It cannot become a complete producer candidate, accepted report, GO or resume within the same spent run. A fresh owner-requested run has a new ID and explicit new allowance; it never rewrites the old result. UI and timeline show **“Ufuldstændig — ikke færdigverificeret / Incomplete — verification unfinished”**, with counts and omissions. Budget caps control exposure; they do not establish price savings. The two public studies in [#106](https://github.com/Biyocon/biyocon-harness/pull/106) do not establish stable phase-A net savings; no budget acceptance criterion may conceal a failed or expensive trial.

### Delivery and package ownership

Implement shared state/parsing/hash/accounting in `packages/conductor/conductor`, dispatch/guards/material capture in `packages/conductor/tool-conductor`, trusted role resources/presets in Conductor, and presentation in its UI plugin. Record any generic preflight/input-bound exception in the [core dependency inventory](../architecture/2026-11-05-conductor-core-dependencies.md), with files, rationale and actual PR number. Keep core Conductor-free. SDK work projects existing generic checkpoint/tool results; any new event or loop lifecycle requires both SDK expected outputs and catalog regeneration.

Use one integration branch with reviewable commits. Merge no partial interpretation of v6: either one complete PR, or individually safe generic prerequisite PRs followed by one complete format integration PR. v5/older Conductor records become unavailable without migration, while their chat history remains openable through the #79 availability handling. Saved records are validated on use; opening/replay isolates failures without falling back to a guessed run. Add no new Conductor event types solely for ledger fields. Generic per-attempt request metadata is a separately reviewed prerequisite: its envelope is ignorable for old chat reading, but v6 use requires valid referenced metadata. Unknown unrelated required events retain generic strict behavior.

## Alternatives considered

**Separate v6 bumps per issue.** Rejected because the owner requires one schema owner and one reviewed meaning. Feature flags must not reinterpret persisted v6 fields.

**Full non-overlapping report segmentation.** Retains character coverage but not semantic completeness; exact quote claims reduce structural overhead while keeping Auditor's independent omission check. The earlier 520–600 versus 800–1,200 producer-token estimates remain illustrative, not measurements or savings promises.

**Best-effort budgets or history pruning.** Character estimates, volatile counters and post-dispatch reservations cannot enforce the proposed allowance. Pruning stays disabled unless a separate public real-model price study includes lost cache hits and recall costs. Source bounding and cheaper-model evaluation retain their separate scope.

**Reuse Gate C authority for verification repairs.** Rejected: verifying supplied work never authorizes new writes. Starting a new implementation run preserves explicit owner control.

## Acceptance criteria

- G0 passes before schema/version freeze: compare both candidate bounds with exact-route usage, prove adapter-level retry/logging, and obtain owner approval before paid calibration.
- Parser/tamper tests cover every required group, impossible transitions, stale/foreign identities, oversized data, malformed reservation arithmetic and v5/unavailable history isolation. All fixtures are synthetic.
- Claims: missing/duplicate/overlapping quotes, omitted material assertions, cyclic premises, current-request laundering, wrong source spans, mode switching, embedded directives and missing/wrong labels fail appropriately. Test source-backed strictness, source-free acceptance and Auditor's irrelevant-source downgrade with logged reason, whole-report labels, unchanged source history and restricted subsequent dispatch through actual composition.
- Verification: Git dirty/untracked/deleted and non-Git candidates, changes during capture/check/audit, cold resume, read-only repair and denied write/GO/approval transfer use real filesystem and approved quality paths.
- Accounting: concurrent reservations, retry ordinals, crash before/after dispatch or settlement, duplicate/conflicting usage, absent cache fields, reasoning inclusion, provider overrun, descendant attribution and exhausted rework/continuation never create free calls or double charges. Prove unsupported providers fail before dispatch.
- Keyless runnable examples cover labelled reports, terminal-tool rendering with deferred context/steering, verification entry, rework/resume, and incomplete output. Both SDK projections and shipped-preset GUI/GIF evidence must preserve canonical labels, counts and unavailable history. Real-model public trials report full price and quality, including failures; owner app/home remain untouched.

## Risks

Semantic omission/materiality/source support remain model judgments. Conservative preflight can reject useful work, and a misbehaving provider can overrun one call; the ledger exposes that rather than promising prepaid invoice control. Checkpoint figures are a size simulation, not measured v6 or complete-log predictions; the complete schema must revalidate the proposed limits. Cross-process writers remain unsafe until #51 is implemented. The new generic request hook and input-bound capability are planned dependencies requiring separate scrutiny, not permission to put Conductor logic in the core. Implementation starts only after this combined design is reviewed and the owner orders it.
