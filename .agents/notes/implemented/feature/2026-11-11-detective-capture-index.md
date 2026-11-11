# Agent Note: Detective capture index

Status: implemented

English | [中文](2026-11-11-detective-capture-index.zh.md)

## Problem

The approved [Detective cost design](../../proposed/feature/2026-11-05-conductor-detective-evidence-budget.md) retains full captured files in v5 admission but sends every body to Detective before inspection. Workspace reads can observe another version; shortening initial input must preserve the admitted evidence and later reviewers' basis.

## Decision

Detective receives the unchanged request and an ordered index from captured identity, selector, SHA-256 and content, with derived UTF-8 byte and cited-line counts. Complete bodies remain in the v5 checkpoint. Other specialists, critic excerpt validation and Auditor retain their full existing source access.

A trusted contribution installs `conductor_read_capture` beside search only for Detective with files. It closes over captured text, checks selector-bound identity and hash on every read, and rejects unknown identities, excessive ranges and changed hashes without workspace access. New children after resumption rebuild the reader from saved admission; no private spill or continuable-child protocol is needed.

Guidance treats inline current-request as scope, not file corroboration, and excludes it from the file reader. Every candidate material ID needs disjoint inspected line spans. Reports retain required findings, adverse evidence and uncertainty; sampled pages or workspace-only checks do not establish complete capture coverage. Validators and gates remain unchanged.

The [tools registry](../../../../packages/core/tools/src/index.ts) restricts inherited names; child-local definitions remain visible and cannot be named in `tools.restrict`. Consequently `childToolFilter` keeps the unchanged inherited read allowlist, while the scoped contribution supplies the reader and a Detective-specific execution guard explicitly permits it. Passing this local name in the filter fails before child creation. This refines the design's filter wording without a global placeholder, wider `READ_TOOLS`, or core changes. Other analysis roles still reject the name.

The [README](../../../../packages/conductor/tool-conductor/README.md) owns validated character and line limits. Complete canonical JSON contains identity, range, line text, truncation and next line within the character cap. Whole lines are never silently cropped; an oversized line fails explicitly. Rendering and finalization bound policy replacements, failures and feedback. Generic UI cards derive file locations only from call arguments.

The dispatch package and tool calls/results use existing logged inputs. No history rewriting, event type, record bump, budget ledger, coverage assertion or `incomplete` state is introduced. Provider contribution support remains mandatory.

## Alternatives considered

**Read workspace files.** Rejected because a changed file cannot substantiate the saved capture's hash or line references.

**Register a global placeholder or change core filtering.** Rejected because existing child-local registration already supplies the required capability without exposing a global reader or altering other roles.

**Send every captured body.** Preserves eager access but repeats unnecessary initial input. Indexing trades that cost for explicit bounded reads; it cannot guarantee a cheaper completed report.

## Consequences

Unit tests cover index order, immutable capture, line endings, Unicode, complete-result limits, later findings, corruption, role guards, registration rollback and disposal. The installed headless Loader scenario reads four saved pages after the synthetic workspace file changes, reaches its final adverse finding, and retains original critic/Auditor evidence through the accepted report. Logged request headers also pin Detective guidance and its absence from review roles. Existing Detective snapshots include indexed dispatches and reader calls where needed.

The historical run contained no files, giving zero estimated saving here. The [public comparison](https://github.com/Biyocon/biyocon-harness/pull/106) on `41136d904c` shows higher capture-case cost per completed report after span/rework failures. Revised guidance requires a fresh price/quality measurement, without lowering gates. Coordinated v6 retains budget/coverage accounting. No owner session data is needed.
