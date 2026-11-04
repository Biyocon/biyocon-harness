# Agent Note: Isolated validation primitives for analysis challenges

Status: implemented

English | [中文](2026-11-02-conductor-analysis-critic-primitives.zh.md)

## Problem

The [analysis critic design in EN](../../implemented/feature/2026-10-28-conductor-analysis-critic.md) and [ZH](../../implemented/feature/2026-10-28-conductor-analysis-critic.zh.md) requires a critic result bound to the exact candidate and admitted evidence. Keeping challenge validation and evidence selection in pure modules lets the driver use one checked result without making schema parsing, hashing and route decisions inseparable.

## Decision

[Challenge validation](../../../../packages/conductor/conductor/src/analysis-challenge.ts) and [captured-material selection](../../../../packages/conductor/conductor/src/analysis-materials.ts) are pure modules exported through the package entry point. The analysis driver and typed critic dispatch call them; the helpers themselves create no checkpoint, event or configuration value.

The challenge validator treats a model result as untrusted. It checks the run, candidate version and hash, ordered material IDs, critic identity and attempt, findings, conclusion and the conditional `defect` field. One shared semantic check rejects duplicate material and finding IDs, findings that cite material outside the challenge, and conclusions inconsistent with finding severity. Validation, challenge hashing and validation of every `previous` challenge use this check, so a semantically invalid challenge cannot receive a hash. `does_not_hold` requires `scope | plan | report`; `holds` forbids `defect` and unresolved major or critical findings. A foreign, stale, contradictory or route-invalid result fails validation. The typed defect is the sole source for later rework routing; free-text findings cannot select a role.

Material spans identify admitted captured material and inclusive line ranges. Validation checks the captured content against its recorded hash and rejects missing, changed or out-of-range material. The runtime-independent selector uses a stable material and span order and joins referenced lines with LF. It measures the entire constructed critic prompt, including instructions, candidate, acceptance criteria, material index and excerpts, against the supplied token bound and fails instead of truncating. The prompt carries runtime-owned run, candidate and critic identities plus the expected material order in a dedicated structured `identity` field. The helper recomputes the candidate hash before accepting that identity; span, excerpt and parsed challenge material IDs use `ConductorMaterialId`. The context defines `criticAttempt` as increasing across the whole run, including new candidate versions; the driver allocates it during dispatch. The selected input is logged and can be reconstructed without letting a critic explore the repository or choose its own excerpts.

## Alternatives considered

**Combine validation and extraction with the analysis driver.** That would couple route transitions to untrusted JSON parsing and span selection. Separate helpers keep candidate, material and challenge checks independently testable while the driver persists only validated results.

**Let the model choose evidence or rework targets from prose.** Unlogged file exploration and text-derived routing cannot be replayed reliably. Captured hashes, typed spans and typed defect classes make both decisions inspectable.

## Consequences

Conductor uses these helpers on every analysis critic dispatch under record format 5. Unit and property tests pin the schema, stale and contradictory rejection, span/hash validation, deterministic bounded extraction and stable challenge hashing at 100% source coverage. [The activation decision](2026-10-28-conductor-analysis-critic.md) owns route, persistence and owner-escalation semantics.
