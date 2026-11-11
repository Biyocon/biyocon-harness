# Agent Note: Tool-associated prompt sections

Status: implemented

English | [中文](2026-11-11-tool-associated-prompt-sections.zh.md)

## Problem

[Issue #75 phase 1](https://github.com/Biyocon/biyocon-harness/issues/75) concerns tool guidance inherited by children whose effective tool view excludes that tool. An unavailable `web_search` instruction is a concrete prompt contradiction. Removing only its wire schema does not remove independently registered prose, while deriving visibility from wire schemas would incorrectly hide SDK-callable capabilities in Code Mode.

## Decision

[PromptSection](../../../../packages/core/system-prompt/src/index.ts) optionally declares `requiresTools`. Assembly resolves scope shadowing, validates every prerequisite against the registered capability universe, then retains the section only when all prerequisites are visible. A supplied list is non-empty and contains unique, non-blank names. Invalid references fail at assembly; known filtered names suppress the section before text evaluation, including complete sections. Unassociated sections retain their behavior. Section names have no implicit tool semantics.

Tool providers can report separate known and visible capability names through `ToolProviderResult.capabilities`; omission derives them from existing name/schema inputs. [ToolRuntime](../../../../packages/core/tools/src/index.ts) supplies the scoped lookup view independently of native/code/both wire projection. Code Mode therefore retains guidance for SDK-callable tools. Each assembly recomputes visibility, including fresh and resumed children. Hidden registered sections remain omitted after the cooperative waterfall; listeners retain authority over unassociated content. Association metadata is not a security boundary.

[Web search](../../../../packages/web/tool-web/src/search.ts) associates its base guidance with search and its separate fetch follow-up with both tools. [Fetch](../../../../packages/web/tool-web/src/fetch.ts) associates its guidance with fetch and does not suggest unavailable search. Provider availability does not determine registration or visibility. Execution restrictions and Conductor authority remain unchanged; the core imports no Conductor package.

The resulting system prompt uses existing logged request headers. This partially supersedes only the independent-guidance rule in [child composition](2026-07-12-subagent-persona-tool-filter-and-depth.md); persona, depth, execution filtering and provider requirements remain active. It implements the generic part of [the approved verification design](../../proposed/feature/2026-11-05-conductor-analysis-claim-verification.md), without changing session/Conductor formats or implementing its claim classifications, denial counters or evidence modes.

## Alternatives considered

**Parse a `tool:` section prefix.** Rejected because names are identities, not typed capability declarations, and one section may require several tools.

**Patch Conductor child prompts.** Rejected because inherited unavailable guidance affects generic subagent composition and would couple the core to one consumer.

**Use only visible wire schemas.** Rejected because code-only presentation collapses callable capabilities behind `run_code`.

## Consequences

Invalid associations fail on the first resolvable assembly rather than silently dropping a typo. Restricted scopes omit associated prompt tokens and can change the reusable prefix; unchanged scopes remain deterministic. Other tool plugins opt in explicitly. No tool access is granted by an association, and removing contradictory guidance does not guarantee that a model never attempts an unavailable call.

Owning tests exercise arbitrary section names, malformed associations, hidden-provider suppression, shadowing, complete sections, Code Mode and parent/sibling isolation. Real spawn/fork children verify logged initial and cold-resume prompts. The keyless ACP example compares parent/child prompts and schemas through the actual Loader, using public synthetic replay material and owned project roots. Unrestricted children reuse identical parent-class pins; restricted children own distinct pins. Both undergo full equality checks and fixture-inventory guards. No private data or GUI code is added; provider requests remain owned by the existing loop.
