# Agent Note: Owned project roots for instruction and skill fixtures

Status: implemented

English | [中文](2026-11-10-owned-instruction-fixture-roots.zh.md)

## Problem

Temporary directories can be nested inside a real project. Instruction and skill tests that omit a project marker can discover an ancestor's instructions or skills instead of exercising their synthetic world. Seven local failures in [#93](https://github.com/Biyocon/biyocon-harness/issues/93) came from this assumption; default-home stubbing alone cannot bound project discovery.

## Decision

The [instruction tests](../../../../packages/context/agent-instructions/tests/agent-instructions.spec.ts) mark their owned project roots when testing home selection, labels and unavailable home candidates. The cwd-fallback case explicitly disables marker discovery with the supported empty marker list and places an instruction-bearing marked parent above its cwd. It retains exact assertions for the selected file and display path.

The [skill test](../../../../packages/skill/skill-filesystem/tests/skill-filesystem.spec.ts) separates precedence from no-marker fallback. Precedence uses the owned Git root; fallback mounts the existing filesystem test provider with absent marker metadata throughout its virtual ancestor chain. Skill content still comes from real synthetic files, while host ancestor markers cannot redirect discovery. The provider is disposed after the assertion.

## Alternatives considered

**Change product discovery or accept extra instructions.** Rejected: nearest-project discovery is intentional, and owner data must not become expected fixture content.

**Assume the system temporary directory has no marked ancestor.** Rejected because developer machines can legitimately place temporary directories under a project.

## Consequences

Tests preserve their assertions and production configuration. No runtime code, snapshots, normalizers, timeouts, retries or skips change. Exact home labels, root precedence and provider-based cwd fallback remain covered. Locale-dependent identifier sorting is a separate #93 decision.
