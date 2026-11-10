# Agent Note: Package references and runtime identities

Status: implemented

English | [中文](2026-11-10-rescope-runtime-identifiers.zh.md)

## Problem

[Issue #62](https://github.com/Biyocon/biyocon-harness/issues/62) reports 28 hygiene failures: package rewriting misclassifies Cordis event names and UI/preset labels. Renaming them changes product routing or namespaces. PR static CI also omits the rescope check.

## Decision

The [codemod](../../../../scripts/rescope-vendor.ts) preserves exact event values, their namespace filter and documentation wildcard. Bare `cordis` labels are preserved only in named UI/preset owners. These distinctions apply to tokens: module imports, exports, dynamic imports, require, require.resolve and module declarations in those files still follow the package mapping. TypeScript's scanner recognizes source contexts through comments and newlines. Escaped event signatures in generated catalogs retain their spelling.

[Shared static CI](../../../../scripts/run-gates.ts) executes `rescope-vendor:check`. The [original package-rescope decision](../process/2026-08-10-vendor-package-rescope.md) and exact edits remain active. Literal before/after examples in the codemod's regression file are excluded from rewriting, like the mapping source. Other package references and manifests remain checked.

## Alternatives considered

**Rename every reported token.** The 28 reported files use event or label identities; changing them breaks semantics or generated-source consistency.

**Exclude all affected files.** That hides new package references. Explicit values and named label owners preserve module checks within the same files.

## Consequences

The correction changes classification, not product code or generated event catalogs. Regression cases cover runtime identities, module references in the same owner, comments, multiline references, reverse mapping and idempotence. Existing file-level exceptions for other historical identifiers remain unchanged. New event spellings or label owners require explicit classification and regression coverage.
