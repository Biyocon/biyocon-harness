# Agent Note: Separate analysis critic instructions

Status: implemented

English | [中文](2026-11-03-conductor-analysis-critic-instructions.zh.md)

## Problem

Devil's Advocate produces reports on the current analysis routes. Giving it critic instructions in the same Markdown body would change those producer dispatches before the critic route exists. A missing critic instruction set must also fail before a preset publishes an agent.

## Decision

The canonical [Devil's Advocate role](../../../conductor/roles/03-devils-advocate.md) and [specialist skill](../../../skills/conductor-specialist/SKILL.md) carry `metadata.analysisCritic` with `dispatchMode: critic` and nonempty `instructions`. Their Markdown bodies remain the producer instructions. The [preset loader](../../../../packages/conductor/conductor-presets/README.md) rejects either required skill when its critic metadata is absent or invalid, before role registration. The internal typed producer dispatch uses the existing Markdown bodies and policies. The typed critic dispatch selects only the two metadata instruction strings. The analysis routes and record format remain unchanged.

The critic challenges priorities, alternatives, overlooked risks, and whether recommendations follow from the admitted evidence. Auditor retains factual and citation checks. Critic input is limited to the latest candidate and runtime-selected admitted excerpts; the model does not select the excerpts or inspect the repository anew. A `does_not_hold` result identifies findings and a scope, plan, or report defect. Intake rejects image attachments before an analysis run, so the critic never infers their contents or treats an owner answer as implementation permission. [The analysis-critic design](../../proposed/feature/2026-10-28-conductor-analysis-critic.md) owns the eventual route and result semantics.

The internal critic dispatch uses the existing one-child workflow and fresh subagent provider. The host reserves the real child id before [building the hash-checked prompt](../../../../packages/conductor/conductor/README.md), places that id in the prompt's dedicated identity field, and logs the runtime-selected excerpts as model-visible child input. A per-dispatch output ceiling includes reasoning; unsupported providers reject the dispatch. The child receives no file or search tools. The returned structured value passes the P1 identity, semantic, and candidate-lineage validator before a gate can consume it. The active v4 routes never select this critic branch.

The [official Chat Completions API](https://api-docs.deepseek.com/api/create-chat-completion/) documents `finish_reason: length` for `max_tokens` and exposes reasoning tokens inside completion usage (consulted 2026-11-03). A real API test sends `max_tokens: 32` to both `deepseek-v4-flash` and `deepseek-v4-pro`, checks the wire finish reason, and verifies that reported completion tokens include reasoning without exceeding the cap.

## Alternatives considered

**Appending critic prose to the role body.** The current producer receives that body, so appending the prose would alter active analysis behavior before the critic dispatch is implemented.

**Accepting missing metadata until the route is enabled.** This would let an installation start with incomplete instructions and fail only after a critic dispatch, contrary to preset validation's existing fail-loud behavior.

## Consequences

The preset and dispatch validate separate producer and critic instructions while leaving current producer prompts, record format, and routes intact. The critic's complete prompt and persona are logged in its child session. The real API test uses a key only from the process environment and skips without one.
