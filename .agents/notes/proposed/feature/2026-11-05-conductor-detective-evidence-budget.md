# Agent Note: Bounded Detective evidence and token use

Status: proposed

English | [中文](2026-11-05-conductor-detective-evidence-budget.zh.md)

## Problem

[Issue #58](https://github.com/Biyocon/biyocon-harness/issues/58) records an owner-reported Detective cost of about 472,000 tokens for a large folder. The private run has not been replayed, so its distribution among prompt repetition, repository reads, model output, and rework is unknown. The cost must become predictable without presenting an uninspected source as reviewed or weakening the evidence available to the critic and Auditor.

On `b230cf38ac`, [intake capture](../../../../packages/conductor/tool-conductor/src/materials.ts) stores the complete current request and explicitly cited text files, bounded by 16 files, 65,536 bytes per input, and 262,144 serialized admission bytes by default. [Detective dispatch](../../../../packages/conductor/tool-conductor/src/index.ts) embeds the complete `admission`, including every captured file's `content`, in its JSON prompt. The child also receives the Detective and shared specialist skills, the structured output schema, and read/search tools (`read`, `read_image`, `grep`, `glob`); its later model requests can include logged read results. The current producer path has no Detective-specific input or cumulative token limit. The [critic](../../../../packages/conductor/tool-conductor/src/analysis-dispatch.ts) instead receives candidate-bound excerpts and has recorded per-attempt and per-run token limits.

## Proposal

Keep the full, hash-verified intake capture in the durable run. At Detective dispatch, include the complete current request and a deterministic index of every captured file: selector, material ID, hash, byte and line counts, and explicit `not inspected` status. Replace the repeated file bodies in the initial Detective prompt with a read-only, child-scoped tool that returns requested line ranges from that immutable capture. The tool verifies the admitted hash, records the exact requested range and returned text in the child session, rejects unknown IDs and over-budget requests, and never rereads a changed workspace file as if it were the admitted material. Its UI render intent is `generic` with `locations` for the exact source selector and line range, derived only from its arguments. The generic workspace read/search tools remain read-only for discovery; their returned text and token cost count against the same Detective budget. A discovered but uncaptured file cannot acquire an admitted material ID or citation by model assertion.

Record a host-owned coverage ledger for each Detective attempt: every admitted material's inspection status (`read`, `summarized`, or `not inspected`), ranges actually read, selection reason, and omitted bytes/lines; record discovered workspace paths separately with their observed version or digest when available. A summary is a navigation aid, never evidence for an unobserved claim. Selection can prefer owner-cited sources and matches to the stated question, but the complete index stays visible and every exclusion is explicit. If a relevant source cannot be read within the remaining budget, Detective returns a bounded, incomplete result with the omitted selectors and affected conclusions; Conductor must not turn it into a comprehensive `ready` report or pass it to the critic as a complete candidate. Owner continuation may authorize a fresh run or narrower question, but cannot relabel unreviewed evidence as reviewed.

Add validated deployment limits for estimated input per Detective model request, reasoning-inclusive output per child, and total provider-reported Detective tokens per run. Capture those limits at admission, reserve before each child and model request, and count input, cache read/write, output, and reasoning without double counting. The request preflight includes persona, tool schemas, system sections, the full logged history, and the next input; a byte or token estimate that excludes tools is insufficient. A provider route without a defensible preflight bound or an enforceable output ceiling fails before dispatch. Charge reported usage after each call; missing or invalid usage consumes the reserved allowance and blocks another call. An actual provider overrun stops the run and is disclosed; no preflight can retroactively prevent a provider from overspending one call. New child attempts after rework or owner resumption share the retained run budget. At a limit, persist consumed/reserved/limit, inspected and omitted material, and a terminal `incomplete` status, with no automatic rework loop that silently resets the allowance.

Detective remains read-only and retains scope clarification. The producer's cited `material_spans` continue to bind to complete admitted captures. The [critic's excerpt validation](../../../../packages/conductor/conductor/src/analysis-materials.ts) and mandatory challenge remain unchanged. Auditor keeps access to the same full admitted material and must reject unsupported or incomplete factual claims; this design does not save Auditor tokens by reducing its evidence. Gate C, implementation approval, and GO authority do not change. Image intake remains unsupported.

## Measurement and expected savings

The following is a source-level measurement on `b230cf38ac`, not a model run. An in-memory script used `captureIntakeMaterial`, `admitIntake`, `createRun`, and the exact `composeSpecialistPrompt` function transpiled from master. It supplied a short synthetic request and 0, 1, or 16 cited ASCII files of 12,000 characters each; the 16-file serialized capture was 199,854 bytes, below the default cap. It measured prompt and skill/schema string lengths using the same four-characters-per-token proxy used by the critic preflight. No private files or provider credentials were used.

| Cited files | Detective prompt characters | Prompt token proxy | Captured-content contribution, including request | Initial prompt + Detective/shared skills + output schema proxy |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 2,790 | 698 | 16 | 3,180 |
| 1 × 12,000 | 15,406 | 3,852 | 3,079 | 6,334 |
| 16 × 12,000 | 204,640 | 51,160 | 49,020 | 53,642 |

The proposed index for those 16 files is about 4,505 characters, or 1,127 proxy tokens. If Detective needs four complete files, their 48,000 characters add about 12,000 proxy tokens: the first-request material component falls from about 49,020 to about 13,127 proxy tokens, a gross reduction of about 35,900 (73%). If the child makes eight requests that retain all read text, the illustrative gross difference is about 287,000 proxy tokens; tool envelopes, history growth, provider tokenization, caching, and later reads change that figure. Reading all 16 files removes most of the saving. The owner-reported 472,000 tokens cannot be decomposed or used as a verified baseline from this synthetic test.

## Durable format and coordination

New retained budget fields, coverage status, and terminal incomplete semantics change the validated Conductor run record. `CONDUCTOR_RECORD_FORMAT_VERSION = 5` must not acquire that new meaning; implementation needs the next monotonic format version. [Issue #30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30) also requires v6 for Auditor entry, verification, dirty-file digests, and a file manifest outside Git. Agree on one v6 record and manifest owner before implementing either issue. If #30 publishes v6 first, #58 uses the next version instead of reusing v6. The phase-2 manifest should supply stable path/version provenance for newly discovered files; until then, workspace discoveries remain explicitly provisional and cannot silently become admitted material.

## Alternatives considered

**Only lower `maxMaterialFiles` or `maxMaterialBytes`.** This would reject or omit source material before Detective can identify relevant evidence; it does not address repeated workspace reads. Keep the current intake limits as safety bounds, not as the cost design.

**Summarize every file before Detective.** Summaries can erase decisive counterevidence and create an unverified second analysis. The proposed index and exact on-demand ranges preserve original text and identify anything unread.

**Cap only Detective output or trim its final report.** The measured initial input and repeated read history dominate this case; a short answer alone cannot bound input cost or establish coverage.

**Reuse the critic's excerpt-only prompt unchanged.** The critic evaluates a completed candidate with spans. Detective must discover scope and decide which evidence to inspect, so it needs a complete source index and controlled reads rather than only producer-selected excerpts.

## Acceptance criteria

- On public synthetic small and large repositories, compare the current path and proposed path using provider-reported input, cache, output, and reasoning usage for initial calls, repeated reads, rework, and resume; publish source hashes, measurements, and caveats without private data. Include a case where all files matter and savings disappear.
- Seed a relevant finding in a late indexed file and an adverse finding in a nonselected file. Either both remain traceable to exact material IDs and lines or the result is explicitly incomplete; no accepted full-scope report may hide an omitted source. The critic and Auditor must retain their current challenge and citation checks.
- Unit and assembled keyless snapshot tests cover index ordering, immutable range reads, changed or unknown material rejection, zero/partial/full coverage, preflight refusal, missing usage, one-call overrun, total exhaustion across rework/resume, and terminal incomplete presentation. Both SDK projections update if the run/session events change.
- Validate config at load and persisted limits/ledger on replay. Confirm that analysis remains read-only and cannot acquire execution approval or GO, including after owner answers.

## Risks

An index can still miss uncited workspace files; without the coordinated #30 manifest, the result must state that discovery is incomplete. Conservative preflight may stop a useful analysis early, while a provider can still overspend a single call; the report must show both cases. Snapshot reads add tool overhead and latency, and reading every source can consume as many or more tokens than the current path. A separate v6 introduced without #30 coordination would cause avoidable format churn.
