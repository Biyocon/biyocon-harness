# Agent Note: Public Conductor price and evidence measurement

Status: implemented

English | [中文](2026-11-11-conductor-public-cost-experiment.zh.md)

## Problem

The [Detective design](../../proposed/feature/2026-11-05-conductor-detective-evidence-budget.md) estimates a 12.58% gross price reduction from shorter search results. Extra pages, reasoning, cache changes and rework can erase it. Comparing successful attempts alone can also hide the cost of analyses that never complete. The owner prioritizes the bill for a completed, adequately evidenced analysis.

## Decision

Use the [public experiment](../../../../scripts/conductor-cost/README.md) to compare fixed built runtime revisions through the real Loader, shipped Conductor preset and official model. Both arms use identical generated sources/tasks, separate state, read-only policy and no automatic provider retries. Alternate arm order across three repetitions per case. Preserve the frozen observer's SHA-256 and every attempt, including owner escalation and stops; never overwrite a failed trial to obtain a better sample.

One case stresses broad discovery without admitted files. The other has three admitted captures with required findings in every source. Deterministic source hashes and an independent answer manifest bind expected identifiers and locations. The analyzer checks actual exposure to the final producer, saved-source spans, unchanged hashes and the file inventory; an accepted model verdict is insufficient. Current-request text, returned structured output and denied tool calls cannot supply source evidence. Source-discovery observations do not acquire admitted identities.

The observer passes provider chunks unchanged and records usage once per call. The analyzer reconciles it against logged assistant messages by session, turn and step. Uncached input and cache-read are disjoint; reasoning is included in output. Missing cache-write is unreported, not zero. Missing/unpriced usage propagates an unknown total. Repeated tool-result characters describe retransmission, not provider token allocation.

Apply the [official prices](https://api-docs.deepseek.com/quick_start/pricing/) checked 2026-11-11: Flash off-peak USD 0.15/0.003/0.60 per million uncached/cache-read/output tokens. Report standard off-peak equivalents, not invoices or account deductions. The requested `deepseek-flash` alias is documented as DeepSeek-V4.1-Flash-1017; weights are not pinned. Remote cache state cannot be reset, and [cache hits are best effort](https://api-docs.deepseek.com/guides/kv_cache/).

The primary price divides all attempt costs by completions passing the named source/answer checks. Show completion counts, individual costs, model/tool calls, every result's character count, output and rework alongside it. Publish only content-free generated metadata; full requests, reasoning, sessions and logs stay local. The experiment neither reads owner sessions nor operates the application on port 10822.

## Alternatives considered

**Token totals or successful-attempt means alone.** Rejected: inexpensive cached input and failed attempts distort the owner's monetary objective.

**Replay-only or private-run comparison.** Replay pins behavior but cannot measure current model usage, cache effects or cost. Public synthetic material permits reproducibility without disclosing private sources. Existing keyless runtime snapshots remain necessary and are not replaced.

**Product budgets or proactive pruning during measurement.** Rejected: either changes the treatment. External experimental stops are disclosed failures, not v6 accounting or efficiency gains.

## Consequences

Focused accounting tests reject double charging, unknown usage, mismatched logs, forged source support and survivor-only price comparisons. The [initial results](../../../../scripts/conductor-cost/README.md#observed-experiment-2026-11-11) and [separate guidance follow-up](../../../../scripts/conductor-cost/README.md#guidance-follow-up-2026-11-11) retain failures and disclose capture price regressions. Role allocations and arithmetic break-even scenarios distinguish observed usage from causal explanations or achievable savings; fewer model calls do not imply a lower bill. Controls and cache states differ between studies; their trials are not pooled. Small samples do not establish universal savings. Oracle qualification checks named critical findings, not every semantic claim or Auditor judgment; incidental assertions and completeness still need review. Empty Git markers isolate instructions but do not exercise Git verification. This measurement extends the active Detective design without superseding its source-cap, evidence or v6 decisions. No runtime, SDK or record change follows from a benchmark result.
