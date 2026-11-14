# Agent Note: Detective search pages

Status: implemented

English | [中文](2026-11-11-detective-search-pages.zh.md)

## Problem

The approved [Detective cost design](../../proposed/feature/2026-11-05-conductor-detective-evidence-budget.md) identifies large fresh search results as avoidable input cost. Global limits affect every role; rewriting old results can discard inexpensive cache hits. A character limit without retrievable omissions can hide relevant evidence.

## Decision

Detective receives scoped `glob` and `grep` definitions through the trusted child contribution, including analysis producer dispatch. Providers without contribution support remain rejected. Other roles retain inherited tools. Critic excerpts, Auditor evidence, read-only guards and owner authorization remain unchanged. No core package changes or record bump are involved.

The [tool README](../../../../packages/conductor/tool-conductor/README.md) owns configuration. Complete page text includes its digest, shown/total counts, range, truncation flag and next cursor within the Unicode-character limit. Entries remain whole; an entry that cannot fit fails explicitly. Grep retains independently bounded line previews: cropped lines are marked and require `read` for full context. Search hits are not automatically admitted or verified material.

New searches retain the complete formatted discovery result before publishing a cursor. Glob sampling places one path from each top-level group before remaining paths; disabling it preserves search order. Cursors identify a random private artifact, SHA-256 digest and next offset. Run and producing-child identities determine ownership. Continuations accept only the cursor, validate owner, kind and digest, and read saved results rather than searching changed files. Reinstalled contributions use the same store. Missing, altered, oversized or invalid artifacts fail without workspace fallback.

The store creates exclusive random files with owner-only creation modes under the configured private directory. Its internal artifact version 1 is unrelated to Conductor record versions. Complete serialized artifacts have a separate byte limit. Displayed pages and digests use existing durable tool events; no prior history is rewritten. Moving the directory or losing artifacts makes existing cursors unavailable. No automatic cleanup occurs.

Conductor specialists remain one-shot children. Resuming a run dispatches a fresh child, whose namespace rejects old cursors. A trusted reinstall for the same child can read retained pages after process restart; this does not introduce continuable Conductor children.

Canonical Native/Code Mode values are bounded strings. Rendering rejects oversized policy replacements; final content bounding covers errors and policy feedback. Generic cards distinguish searches and continuation pages. Shortened display never conceals a complete canonical result.

## Alternatives considered

**Lower global item caps.** Rejected because they change other roles without bounding complete characters or providing stable continuation.

**Search again for each page.** Rejected because file changes can cause gaps, duplicates or different meanings for old cursors. Private snapshots consume disk but preserve continuation identity.

**Prune history or stop early.** Neither establishes a cheaper completed analysis. Pruning remains an optional measured experiment. Capture indexing remains separate Phase A work; budgets, coverage accounting and `incomplete` remain in the coordinated v6 proposal.

## Consequences

Tests exercise real ripgrep, scoped registration/disposal, workflow/spawn producer dispatch and exact logged/model-visible pages, plus corruption, ownership, Unicode and limit regressions. Separate source-launched processes verify retained pages after source replacement and reject foreign ownership or missing storage. The built headless Loader snapshot reads all five glob/grep pages despite external workspace changes, retains a late finding, and completes the normal critic/Auditor/Arbiter route. Existing scenario goldens remain unchanged.

Additional pages and unchanged output costs can offset input savings. The historical 12.58% price-equivalent scenario is not a realized saving. Public real-model comparisons must assess net price and relevant findings, including later pages. Private artifacts require retention and backup consideration. Verification needs no owner session data.
