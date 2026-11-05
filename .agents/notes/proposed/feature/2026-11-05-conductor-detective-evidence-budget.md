# Agent Note: Detective evidence and repeated-history cost

Status: proposed

English | [中文](2026-11-05-conductor-detective-evidence-budget.zh.md)

## Problem

[Issue #58](https://github.com/Biyocon/biyocon-harness/issues/58) reports about 472,000 Detective tokens on a large folder. The approved local measurement below identifies repeated conversation and tool results as the main opportunity in that run. A limit alone would end the analysis sooner; useful savings require sending less redundant material while keeping every uninspected source visible and preserving the critic's and Auditor's evidence.

In the current [dispatch](../../../../packages/conductor/tool-conductor/src/index.ts), the Detective prompt includes the complete v5 `admission`, including captured file bodies. The child can also discover workspace files with `glob`, `grep`, and `read`. Each later model request derives the full model-visible conversation from its session; the existing [tool-result pruner](../../../../packages/compaction/compaction-tool-result-pruner/src/index.ts) runs only when context pressure or overflow triggers compaction. No prune event occurred in the measured child. The [critic](../../../../packages/conductor/tool-conductor/src/analysis-dispatch.ts) receives candidate-bound excerpts and has its own measured budget; this proposal does not reduce its input or the Auditor's access.

## Proposal

### Phase A: reduce repeated input without changing the v5 run record

Keep the complete, hash-verified [intake capture](../../../../packages/conductor/conductor/src/types.ts) in the v5 record. Derive an ordered index of captured files at Detective dispatch from existing `id`, `selector`, `sha256`, and `content`; calculate byte and line counts without adding record fields. Send the current request and index instead of captured file bodies. A child-scoped read-only tool returns bounded line ranges from that exact captured `content`, verifies its hash, and logs its arguments and returned text through the existing tool-call/result events. It never substitutes a changed workspace file. Its UI render intent is `generic`, with `locations` for the requested selector and lines, derived only from arguments. Unknown IDs and excessive ranges fail explicitly.

Address the measured history cost separately in the same phase: after a completed Detective step, proactively replace selected large, older tool-result messages on the model-visible session surface with a small, explicit omission marker, using the existing logged `compaction/prune` and `tool/result` replacement protocol. Keep the original result in the append-only child log. A child-scoped read-only recall tool may return bounded ranges of that original result by stable event identity; the recall itself is logged and charged. Do not prune an unpaired tool call/result, the current step before the model has seen its results, or evidence whose only copy is the proposed shortened text. A deterministic retention rule, configured per deployment rather than hardcoded in a plugin, must identify the eligible age and size. Preserve source identity and any line references needed for citation. A summary or marker is only a navigation aid, never proof of an omitted passage.

Phase A uses existing session event types and unchanged v5 `ConductorRun` fields. The new tools are restricted to the Detective child and admitted run; ordinary workspace reads remain read-only. Workspace discoveries do not gain an admitted material ID or citation merely because a tool returned them. The complete captured material remains available to the critic's excerpt validation and to Auditor. The report must disclose material it did not inspect; Phase A does not claim a durable host-owned coverage ledger or a new terminal status.

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

Reported input was 452,226 tokens, including 384,768 cache-read tokens (85.1%); input plus output was 471,794. Cache hits still consume context tokens but may be billed at a different rate. A price comparison must use the provider's rates for uncached input, cache read, any reported cache write, and output separately; a smaller prompt can lose cache hits when an earlier prefix changes.

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

Across calls 2–9, 660,449 tool-result characters were sent again, compared with 127,098 characters produced by the tools. The v5 capture contained one 99-character current request and **zero captured files**. Therefore the capture-index part of Phase A would save approximately **zero** tokens on this run. For the history part, a counterfactual pass after each completed step using the existing 8,192-character prune threshold, 4,096-character head, and 1,024-character tail would affect seven results and remove 338,328 repeated characters, about 84,582 gross proxy input tokens (18.7% of reported input), if none were recalled. This is not measured provider usage or a net price forecast: recall, new tool envelopes, tokenization, and lost cache hits can reduce or reverse the gain. Phase A acceptance must measure both total prompt tokens and billed cost on a comparable public real-model run. Phase B by itself has **zero expected token saving** for a completed analysis; a limit only stops later calls and must disclose incompleteness.

## Alternatives considered

**Leave pruning tied to context pressure.** No prune occurred in the measured child despite 660,449 repeated tool-result characters. Triggering a deterministic, evidence-preserving pass before later Detective requests addresses cost earlier, but must be checked against cache disruption and recall use.

**Compress or remove older tool results without recall.** This can discard adverse evidence. Logged surface replacement plus bounded recall preserves the original in the session log and makes omissions visible to the model; an incomplete answer is required when the needed passage cannot be recovered.

**Rely on cache hits alone.** The measured 85.1% cache-read share may reduce price, not token consumption or context pressure. Rewriting an early prefix may convert hits to misses, so net price and latency must be measured separately from tokens.

**Choose a cheaper Detective model.** [#35](https://github.com/Biyocon/biyocon-harness/issues/35) owns per-role provider/model choice after #30. A cheaper model may reduce currency cost without reducing tokens, and may weaken evidence selection or structured output quality. Compare it only after the role route and credentials are supported; do not hardcode a model in #58.

**Only cap output, total tokens, or captured file count.** Limits can stop the run or reject evidence but do not make a completed answer cheaper. Keep safety caps and explicit incompleteness in Phase B, not as Phase A's savings claim.

## Acceptance criteria

- Phase A preserves the v5 run record and existing session event formats. Keyless assembled snapshots and focused tests cover index ordering, hash-verified capture reads, bounded logged recall, deterministic proactive pruning, replay, and a late adverse finding that remains retrievable or makes the report qualify its scope. The critic and Auditor continue to receive their present full basis; analysis stays read-only.
- On a public synthetic repository of comparable size with a real model and process-env credentials, compare baseline and Phase A provider-reported uncached/cache input, output/reasoning, total prompt tokens, billed price, latency, recall frequency, and accepted evidence coverage. Include a case where all sources matter and savings disappear. No private session data is published.
- Phase B validates configuration at load, retained allowances and coverage on replay, missing usage, one-call overrun, rework/resume sharing, and terminal incomplete presentation. Add the required keyless transcript and both SDK projections if run/session events change. Coordinate the record version and manifest with #30 phase 2.

## Risks

Proactive surface replacement can destroy a reusable cache prefix, and recall can add more text than pruning saved. A marker can hide decisive evidence unless exact original results remain accessible and the final claim is narrowed when inspection is incomplete. An index does not discover uncited workspace files; without #30's manifest, discovery coverage remains provisional. Conservative preflight can stop useful work, while a provider can still overspend one call. Avoid a separate v6 that conflicts with #30.
