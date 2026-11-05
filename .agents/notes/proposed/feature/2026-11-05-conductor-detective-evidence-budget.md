# Agent Note: Detective result cost and evidence

Status: proposed

English | [中文](2026-11-05-conductor-detective-evidence-budget.zh.md)

## Problem

[Issue #58](https://github.com/Biyocon/biyocon-harness/issues/58) reports about 472,000 Detective tokens on a large folder. The owner's objective is a lower DeepSeek bill for a completed analysis. The approved local measurement shows that most input tokens hit the inexpensive cache, while large search results first enter as expensive uncached input and then recur in history. A limit alone would end the analysis sooner; savings must preserve visible omissions and the critic's and Auditor's evidence.

In the current [dispatch](../../../../packages/conductor/tool-conductor/src/index.ts), the Detective prompt includes the complete v5 `admission`, including captured file bodies. The child can also discover workspace files with `glob`, `grep`, and `read`. Each later model request derives the full model-visible conversation from its session; the existing [tool-result pruner](../../../../packages/compaction/compaction-tool-result-pruner/src/index.ts) runs only when context pressure or overflow triggers compaction. No prune event occurred in the measured child. The [critic](../../../../packages/conductor/tool-conductor/src/analysis-dispatch.ts) receives candidate-bound excerpts and has its own measured budget; this proposal does not reduce its input or the Auditor's access.

## Proposal

### Phase A: bound results at their source without changing the v5 run record

Make smaller `glob` and `grep` results the primary price intervention. Add validated Detective-specific Config limits (`detectiveGlobMaxResultChars` and `detectiveGrepMaxResultChars`), with 4,000 characters as the initial proposed defaults for each. The limits cover the complete model-facing result, including header and continuation marker, alongside the existing item and line caps. Emit a bounded page with `truncated`, shown/total counts, a stable continuation cursor, and enough path/line identity to support a precise follow-up. Fetching the next page is explicit and read-only; every page and its snapshot digest is logged as a normal tool result. Keep a complete immutable search snapshot for pagination or fail clearly if that snapshot cannot be retained. A narrowed query remains available. A capped result is never presented as exhaustive, and the model cannot claim that unreturned entries were inspected. Prefer the existing top-level sampling option for broad `glob` pages so an early page does not silently hide another subtree. Evaluate a lower `read` window separately; its existing `offset` continuation is already explicit.

The current [search Config](../../../../packages/fs/tool-fs-search/src/index.ts) validates `globMaxResults` (default 100 paths), `grepMaxMatches` (250 matches), `grepMaxLineBytes` (2,000 bytes per match), `searchMetaMaxBytes` (65,536 bytes), and raw-output limits. [Read Config](../../../../packages/fs/tool-fs/src/index.ts) validates `readLimit` (2,000 lines), `readMaxLineLength` (2,000 characters), and `readMaxBytes` (51,200 bytes); read already reports truncation and accepts `offset`. Search currently spills a complete formatted result when an item cap is exceeded, but has no complete-result character cap or cursor pagination. The existing [generic spill policy](../../../../packages/spill/spill-policy/src/index.ts) has a validated `maxInlineBytes` cap for plain-text results, but it is byte-based, best-effort, and skips model-facing `read` results; it does not provide stable search pages. These Config values belong to globally mounted tool plugins and cannot simply be set for Detective without affecting other roles. The existing child-scoped tool-contribution and scoped registry can register Detective-specific search definitions that shadow the inherited tools; implementing their character cap and cursor needs tool/Conductor code, but no agent-loop change. Validate the new limits as positive safe integers large enough to carry the fixed page header and continuation marker. Persist the complete result and cursor with the child-owned session evidence so a cold resume does not reinterpret a page against changed files.

Keep the complete, hash-verified [intake capture](../../../../packages/conductor/conductor/src/types.ts) in the v5 record. As a smaller independent improvement, derive an ordered index of captured files from existing `id`, `selector`, `sha256`, and `content`; calculate byte and line counts without new record fields. Send the current request and index instead of file bodies. A child-scoped read-only tool returns bounded lines from that exact captured `content`, verifies its hash, and logs arguments and returned text with existing tool-call/result events. It never substitutes a changed workspace file; unknown IDs and excessive ranges fail. Its UI render intent is `generic`, with `locations` derived from the requested selector and lines.

Source bounding appends shorter tool results without rewriting prior model-visible messages, preserving the cache-prefix opportunity. Phase A uses existing session event types and unchanged v5 `ConductorRun` fields. Workspace discoveries do not gain an admitted material ID or citation merely because a tool returned them. The complete captured material remains available to the critic's excerpt validation and to Auditor. The report must disclose uninspected material; Phase A does not claim a durable host-owned coverage ledger or a new terminal status.

### Phase B: v6 accounting and explicit incomplete outcome

Add a host-owned coverage ledger for each Detective attempt: admitted material inspection and exact ranges, discovered workspace sources with observed version or digest when available, selection reasons, and omissions affecting conclusions. Only exact source spans count as inspected evidence. Persist validated per-request input, reasoning-inclusive output, and per-run total-token limits at admission. Preflight includes persona, system text, tool schemas, next input, and the logged model-visible history; charge provider-reported uncached input, cache read/write, and output as disjoint counts, with reasoning included in output. Missing or invalid usage consumes the reservation and prevents another call; a provider overrun stops the run and is disclosed. Rework and owner continuation share the retained run allowance.

If relevant evidence cannot be inspected within the remaining allowance, record consumed/reserved/limit and the omitted scope, and end in terminal `incomplete`. Do not pass it to the critic as a complete candidate, silently reset the allowance, or turn it into a comprehensive `ready` report. This is a bounded failure mode, not an efficiency saving.

These new run fields and terminal semantics require a new record version. Coordinate one v6 owner and schema with [#30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30), which also plans Auditor entry, verification, dirty-file digests, and a manifest outside Git. If #30 ships v6 first, Phase B uses the next version. The #30 manifest can supply stable provenance for newly discovered files; before it exists, those discoveries remain provisional.

Both phases preserve read-only analysis, the producer's `material_spans` against complete admitted captures, mandatory critic challenge, Auditor's full available evidence, and the existing Gate C/GO authorization rules. Image intake remains outside this proposal.

## Local measurement and expected savings

The owner-approved source is the locally stored `CON-2026-2783` Detective child, recorded on the v5 master baseline. The analysis read the five matching local session logs in place and selected the one child identified as Detective by the parent log. No session data, source names, source text, or excerpts enter this note or PR. Provider usage comes from each logged `assistant/message`; the cache-write field was absent in all nine reports, shown as “—” rather than assumed zero. Reasoning is a subset of output and must not be added to it.

| Call | Uncached input | Cache read | Cache write | Output | Reasoning |
| ---: | ---: | ---: | :---: | ---: | ---: |
| 1 | 9,870 | 0 | — | 1,803 | 1,698 |
| 2 | 15,479 | 11,648 | — | 1,335 | 936 |
| 3 | 182 | 28,416 | — | 996 | 756 |
| 4 | 19,989 | 29,568 | — | 1,514 | 1,329 |
| 5 | 2,383 | 50,944 | — | 1,913 | 1,572 |
| 6 | 5,652 | 55,168 | — | 933 | 702 |
| 7 | 4,118 | 61,696 | — | 3,871 | 3,698 |
| 8 | 7,405 | 69,632 | — | 736 | 592 |
| 9 | 2,380 | 77,696 | — | 6,467 | 4,690 |
| **Total** | **67,458** | **384,768** | **—** | **19,568** | **15,973** |

Reported input was 452,226 tokens, including 384,768 cache-read tokens (85.1%); input plus output was 471,794. The child used `deepseek-v4-pro` outside DeepSeek's peak hours. At the [official V4-Pro prices](https://api-docs.deepseek.com/quick_start/pricing/) checked **2026-11-05**, off-peak rates per million tokens are USD 0.66 uncached input, USD 0.022 cache-read input, and USD 1.98 output. Applied to the logged usage, this is a **price equivalent**, not the historical invoice or an account charge:

| Component | Tokens | USD / 1M | Price equivalent | Share |
| --- | ---: | ---: | ---: | ---: |
| Uncached input | 67,458 | 0.66 | USD 0.044522 | 48.54% |
| Cache-read input | 384,768 | 0.022 | USD 0.008465 | **9.23%** |
| Output, including reasoning | 19,568 | 1.98 | USD 0.038745 | 42.24% |
| **Total** | **471,794** | | **USD 0.091732** | **100%** |

Peak rates double every component to USD 0.183464 total without changing shares. Cache-read is 85.1% of input tokens but only 9.23% of this price equivalent; a token reduction concentrated in cached history has less monetary value than the same reduction in fresh results. Cache-write was unreported and has no separate line in the official V4-Pro price table. DeepSeek's [cache documentation](https://api-docs.deepseek.com/guides/kv_cache/) says hits depend on matching persisted prefixes, so a counterfactual cannot assume an unchanged hit rate after rewriting earlier history.

The child made 22 `glob`, 4 `grep`, 17 `read`, and 1 `structured_output` call. The exact text length of every tool result was counted locally. Only grouped result statistics appear here (Unicode characters, including error text):

| Tool | Results | Total chars | Min | Median | Max |
| --- | ---: | ---: | ---: | ---: | ---: |
| `glob` | 22 | 56,657 | 14 | 14 | 12,266 |
| `grep` | 4 | 32,915 | 301 | 1,308.5 | 29,997 |
| `read` | 17 | 37,499 | 64 | 1,710 | 9,470 |
| `structured_output` | 1 | 27 | 27 | 27 | 27 |
| **Total** | **44** | **127,098** | | | |

The repeated-history column below reconstructs the serialized character length of previously logged, model-visible conversation messages that the DeepSeek adapter would send again at each call; it excludes the fixed system prompt and tool schemas. The first call has no repeated history. Tool-result text is a subset. The token share is only a four-characters-per-token proxy divided by reported total input for that call, not a provider allocation of tokens to message segments.

| Call | Repeated history chars | Of which tool-result chars | History token proxy | Proxy share of input |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0 | 0 | 0 | 0% |
| 2 | 52,059 | 31,788 | 13,015 | 48.0% |
| 3 | 58,662 | 31,956 | 14,666 | 51.3% |
| 4 | 105,722 | 72,023 | 26,431 | 53.3% |
| 5 | 118,781 | 78,187 | 29,695 | 55.7% |
| 6 | 142,459 | 93,741 | 35,615 | 58.6% |
| 7 | 158,353 | 105,311 | 39,588 | 60.2% |
| 8 | 190,641 | 120,372 | 47,660 | 61.9% |
| 9 | 200,777 | 127,071 | 50,194 | 62.7% |

Across calls 2–9, 660,449 tool-result characters were sent again, compared with 127,098 characters produced by the tools. A counterfactual **4,000-character complete-result cap** on `glob` and `grep`, applied to the recorded result sizes without additional page requests or output changes, affects six results: five `glob` and one `grep`. It removes 59,769 characters from their first transmission to the model and 305,357 characters from later repeats, 365,126 in all. At four characters per token, those are about 14,942 first-transmission and 76,339 repeated input tokens. If first transmissions miss cache and later repeats hit it, the current off-peak rates imply about **USD 0.01154** gross price-equivalent reduction (12.58% of this child's USD 0.09173), of which only about USD 0.00168 comes from repeated cached text. This is an explicit scenario, not observed provider usage or a guaranteed bill reduction: the cap's marker consumes some space, pages may be requested, tokenization and cache hits may differ, and model output may change.

Adding `read` to the same hypothetical cap affects three further results, removing 9,346 first-transmission and 19,250 repeated characters; read's existing byte and line windows make that a separate decision. The v5 capture contained one 99-character current request and **zero captured files**, so the capture-index part of Phase A would save approximately **zero** tokens in this run. Phase B by itself has **zero expected token saving** for a completed analysis; a limit only stops later calls and must disclose incompleteness.

## Alternatives considered

**Proactive history pruning with recall.** No prune occurred in the measured child, but cache-read accounted for only 9.23% of its price equivalent. Logged `compaction/prune` plus bounded recall would preserve original results, yet changing an early prefix can convert inexpensive cache hits to expensive misses. This is an optional experiment, disabled by default, and may be activated only after a comparable public-repository real-model run shows lower total price including lost hits, recall calls, and output changes.

**Rely on cache hits alone.** The measured 85.1% cache-read share is already valuable but does not control new, uncached search output or context pressure. Source caps preserve the existing prefix pattern while making first transmissions smaller; actual price and evidence coverage still require a real-model comparison.

**Choose a cheaper Detective model.** [#35](https://github.com/Biyocon/biyocon-harness/issues/35) owns per-role provider/model choice after #30. A cheaper model may reduce currency cost without reducing tokens, and may weaken evidence selection or structured output quality. Compare it only after the role route and credentials are supported; do not hardcode a model in #58.

**Only cap output, total tokens, or captured file count.** Limits can stop the run or reject evidence but do not make a completed answer cheaper. Keep safety caps and explicit incompleteness in Phase B, not as Phase A's savings claim.

## Acceptance criteria

- Phase A preserves the v5 run record and existing session event formats. Focused tests and assembled keyless snapshots cover per-Detective character caps, exact truncation markers and counts, stable cursor pages and cold resume, missing-spill failure, late adverse findings, index ordering, hash-verified capture reads, and claims that qualify uninspected scope. The critic and Auditor keep their current full basis; analysis stays read-only. Other roles retain their existing tool limits.
- On a public synthetic repository of comparable size with a real model and process-env credentials, compare baseline and source-capped Phase A provider-reported uncached/cache input, output/reasoning, total prompt tokens, **price equivalent and actual billed cost when available**, latency, follow-up pages, and accepted evidence coverage. Include a case where all sources matter and savings disappear. No private session data is published. Evaluate proactive pruning separately and enable it only after it wins on total price with cache-hit changes included.
- Phase B validates configuration at load, retained allowances and coverage on replay, missing usage, one-call overrun, rework/resume sharing, and terminal incomplete presentation. Add the required keyless transcript and both SDK projections if run/session events change. Coordinate the record version and manifest with #30 phase 2.

## Risks

Source caps can cause extra page requests and can hide decisive results unless truncation is explicit, pages are stable, and the final claim is narrowed when inspection remains incomplete. A saved search result can be too large or unavailable; pagination must fail visibly rather than imply coverage. Proactive surface replacement remains unproven on price because it can destroy a reusable cache prefix. An index does not discover uncited workspace files; without #30's manifest, discovery coverage remains provisional. Conservative preflight can stop useful work, while a provider can still overspend one call. Avoid a separate v6 that conflicts with #30.
