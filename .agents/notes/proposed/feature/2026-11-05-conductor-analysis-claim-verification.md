# Agent Note: Evidence-bound claims in Conductor analysis

Status: proposed

English | [中文](2026-11-05-conductor-analysis-claim-verification.zh.md)

## Problem

[Issue #75](https://github.com/Biyocon/biyocon-harness/issues/75) reports a read-only analysis in which Detective and Auditor repeatedly attempted unavailable `web_search` calls, then Auditor described unverified facts as correct and Arbiter accepted the report. The observation establishes a verification gap, not that the reported facts were false. The [analysis critic](../../implemented/feature/2026-10-28-conductor-analysis-critic.md) challenges reasoning and explicitly leaves factual and citation checks to Auditor; its `holds` verdict cannot certify those facts.

The present [Auditor role](../../../conductor/roles/05-auditor.md) asks for an assessment of the candidate and its sources without a claim-level verification result. [AnalysisEnvelope](../../../../packages/conductor/conductor/src/types.ts), [ReportDecision](../../../../packages/conductor/conductor/src/types.ts), and their [validation](../../../../packages/conductor/conductor/src/analysis.ts) bind candidate and audit hashes, but do not require a source-backed status for each factual claim. `evidence_reviewed: string[]` is not a proof that the reviewed source supports the accepted claim.

## Proposal

### Explain and remove the unavailable-tool instruction

The source of the `web_search` suggestion is identifiable without private run data. The [base bundle](../../../../packages/bundle/base/cordis.patch.yml) mounts `tool-web` for every mode. Its [search plugin](../../../../packages/web/tool-web/src/search.ts) registers both the tool and an unconditional `tool:web_search` system-prompt section telling the model to use it. [Child composition](../../../../packages/subagent/subagent/src/child-agent.ts) inherits parent prompt sections and then restricts tools. [Conductor's analysis filter](../../../../packages/conductor/tool-conductor/src/workflow-child.ts) exposes only `read`, `read_image`, `grep`, and `glob`, while its [dispatch prompt](../../../../packages/conductor/tool-conductor/src/index.ts) lists `read` as an allowed action. A search of the Conductor role, specialist skill, and dispatch text found no `web_search` instruction. The inherited system text is therefore a concrete conflicting instruction; model behavior may contribute, but need not be invoked as the sole explanation.

In the first implementation phase, suppress guidance for tools absent from the child's effective tool view and state the exact available tool names and no external retrieval in the logged, model-visible analysis dispatch. Apply this to all analysis specialists, including Arbiter, without granting `web_search` or `web_fetch`. Keep the executor filter and guard authoritative. A denied tool call yields one clear, logged correction naming the available tools; repeated identical unavailable calls in the same child fail that attempt visibly rather than consuming unbounded model rounds. Do not add timeouts or automatic retries. Prompt suppression and tool-denial feedback use existing session events and do not change the v5 run record.

### Require a claim-level audit before documented acceptance

In the second phase, the candidate partitions its entire `content` into exact, non-overlapping text ranges marked factual claim or non-claim; each material factual claim has a stable ID. Auditor independently inspects even the non-claim ranges for omitted facts and returns a structured assessment for each claim: `source_verified` with an admitted material ID, exact lines, and the supported proposition; `derived` with identified verified premise claims and the stated inference; or `unverified` with the missing evidence. Model memory and an unsupported URL never qualify as `source_verified`. A workspace file discovered outside admission may guide investigation, but cannot silently become admitted evidence. The host validates complete range partitioning, claim IDs, material IDs and line bounds against the immutable capture, premise references, absence of cycles, candidate/audit identity, and required fields. The semantic match between a proposition and its source remains Auditor's judgment; validated offsets and hashes alone cannot prove it. If an omitted factual claim is found, Auditor must return rework rather than certify the inventory.

Arbiter receives the exact candidate, critic challenge, audit, and claim assessments. `accept` is valid only when every claim material to a conclusion is `source_verified` or a supported `derived` claim, and every remaining unverified claim is explicitly labelled as such and cannot support a conclusion. The host rejects `accept` on an unverified material claim regardless of Arbiter prose. Use `revise` when the producer can cite admitted evidence, remove the claim, or narrow the conclusion within the analysis mandate. Use `blocked` when essential verification needs inaccessible external material or actions outside that mandate; an owner clarification can supply new admitted material through a new authorized intake, never silently extend the active capture. The final EN/DA report uses text labels such as “Unverified / Ikke verificeret” beside each retained unverified claim and states the resulting limitation without relying on colour. Do not label an accepted report “factually verified” when only non-material claims remain unverified; describe the verified scope.

Persist the claim inventory, assessment, and acceptance condition in the Conductor run, with hashes tied to the exact candidate and audit. These required fields and terminal semantics need the next monotonic record version; do not reinterpret v5. Coordinate the version with [#30 phase 2](https://github.com/Biyocon/biyocon-harness/issues/30) and [#58 phase B](2026-11-05-conductor-detective-evidence-budget.md). If either ships v6 first, use the following version. All model-visible instructions, source excerpts, tool-denial feedback, and returned classifications must be reconstructable from the session log. The seven roles, mandatory critic, read-only analysis, and Gate C/GO authority remain as defined by the existing Conductor route.

## Alternatives considered

**Prompt-only warning.** It may reduce unsupported tool calls, but a model can still assert that an uncited fact is correct; typed claim results and a host acceptance rule are necessary.

**Treat every unverified claim as a terminal block.** This would reject useful scoped analyses containing explicitly labelled, incidental uncertainty. Blocking only essential unsupported claims allows a truthful limited report.

**Enable web search for analysis.** It would expand the read-only role's external access, introduce new source provenance and cost, and still not establish that a returned page supports each claim. External retrieval needs its own authorization and admission design.

## Acceptance criteria

An assembled `conductor-installed` keyless snapshot shows the allowed-tool instruction, one denied `web_search` call with bounded feedback, a candidate with verified and unverified claims, Auditor's classifications, Arbiter's `revise` or `blocked` decision for material gaps, and EN/DA labels in a limited accepted answer. Focused validation tests reject missing or overlapping claim coverage, forged material IDs or lines, cyclic derivations, stale hashes, and `accept` on an unverified material claim. Replay preserves the exact classifications and source hashes; both SDK projections update if run or session events change. A public real-model comparison measures extra audit calls and tokens against correct claim coverage. No private session content enters fixtures or logs.

## Risks

Claim inventories and independent review add tokens and may still miss a factual assertion or misjudge source support; the design does not claim formal proof of semantic truth. Strict blocking can reduce completed reports when admitted sources are sparse. Suppressing tool guidance must follow the effective scoped tool view, or it can hide a tool that another role legitimately has. Cross-process concurrency remains governed by [#51](https://github.com/Biyocon/biyocon-harness/issues/51).
