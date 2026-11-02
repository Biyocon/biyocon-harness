# Agent Note: Isolated validation primitives for analysis challenges

Status: implemented

English | [中文](2026-11-02-conductor-analysis-critic-primitives.zh.md)

## Problem

The [analysis critic design in EN](../../proposed/feature/2026-10-28-conductor-analysis-critic.md) and [ZH](../../proposed/feature/2026-10-28-conductor-analysis-critic.zh.md) requires a critic result bound to the exact candidate and admitted evidence. Parsing a critic result or selecting its evidence inside the existing analysis driver would change live routes before the complete record and dispatch semantics are available. The current v4 analysis run must retain its behavior and byte-identical snapshots.

## Decision

[Challenge validation](../../../../packages/conductor/conductor/src/analysis-challenge.ts) and [captured-material selection](../../../../packages/conductor/conductor/src/analysis-materials.ts) are pure internal modules. Neither is imported by the analysis runtime or the package entry point. They create no checkpoint, event, dispatch, configuration value or public package export.

The challenge validator treats a model result as untrusted. It checks the run, candidate version and hash, ordered material IDs, critic identity and attempt, findings, conclusion and the conditional `defect` field. `does_not_hold` requires `scope | plan | report`; `holds` forbids `defect` and unresolved major or critical findings. A foreign, stale, contradictory or route-invalid result fails validation. The typed defect is the sole source for later rework routing; free-text findings cannot select a role. A challenge hash is derived deterministically from the validated result rather than model-supplied hash text.

Material spans identify admitted captured material and inclusive line ranges. Validation checks the captured content against its recorded hash and rejects missing, changed or out-of-range material. The runtime-independent selector uses a stable material and span order and joins referenced lines with LF. It measures the entire constructed critic prompt, including instructions, candidate, acceptance criteria, material index and excerpts, against the supplied token bound and fails instead of truncating. This prepares input that can be logged and reconstructed without letting a critic explore the repository or choose its own excerpts.

## Alternatives considered

**Wire the helpers into the v4 driver immediately.** That would make a partial critic route observable before producer/critic Gate C modes, challenge persistence and Arbiter binding have one final v5 meaning. Keeping the helpers internal preserves the existing run contract while their validation can be tested independently.

**Let the model choose evidence or rework targets from prose.** Unlogged file exploration and text-derived routing cannot be replayed reliably. Captured hashes, typed spans and typed defect classes make both decisions inspectable.

## Consequences

Conductor still runs its existing analysis routes, persists format 4 and produces the same snapshots. The isolated modules add no critic tokens or model-visible input until dispatch deliberately uses them. Unit and property tests pin the schema, stale and contradictory rejection, span/hash validation, deterministic bounded extraction and stable challenge hashing at 100% source coverage. The linked proposal owns the later route, persistence and owner-escalation changes.
