# Agent Note: Detective capture index

Status: implemented

English | [中文](2026-11-11-detective-capture-index.zh.md)

## Problem

The approved [Detective cost design](../../proposed/feature/2026-11-05-conductor-detective-evidence-budget.md) retains full captured files in v5 admission but sends every body to Detective before inspection. Workspace reads can observe another version; shortening initial input must preserve the admitted evidence and later reviewers' basis.

## Decision

Detective receives the unchanged current request plus an ordered file index derived from existing material identity, selector, SHA-256 and content. UTF-8 byte length and cited-line count are calculated without durable fields. Complete file bodies remain in the checkpoint. Other specialists, critic excerpt validation and Auditor retain their existing full source access.

A trusted child contribution installs `conductor_read_capture` beside Detective search tools. Only Detective with captured files receives this definition and guidance. The installer closes over the exact captured text, checks selector-bound identity and content hash on every read, and rejects unknown identities, excessive ranges and changed hashes. It never accesses the workspace. New children after run resumption rebuild the reader from the saved admission; no private spill or continuable-child protocol is needed.

The [tools registry](../../../../packages/core/tools/src/index.ts) restricts inherited names; child-local definitions remain visible and cannot be named in `tools.restrict`. Consequently `childToolFilter` keeps the unchanged inherited read allowlist, while the scoped contribution supplies the reader and a Detective-specific execution guard explicitly permits it. Passing this local name in the filter fails before child creation. This refines the design's filter wording without a global placeholder, wider `READ_TOOLS`, or core changes. Other analysis roles still reject the name.

The [README](../../../../packages/conductor/tool-conductor/README.md) owns validated character and line limits. Complete canonical JSON contains identity, range, line text, truncation and next line within the character cap. Whole lines are never silently cropped; an oversized line fails explicitly. Rendering and finalization bound policy replacements, failures and feedback. Generic UI cards derive file locations only from call arguments.

The dispatch package and tool calls/results use existing logged inputs. No history rewriting, event type, record bump, budget ledger, coverage assertion or `incomplete` state is introduced. Provider contribution support remains mandatory.

## Alternatives considered

**Read workspace files.** Rejected because a changed file cannot substantiate the saved capture's hash or line references.

**Register a global placeholder or change core filtering.** Rejected because existing child-local registration already supplies the required capability without exposing a global reader or altering other roles.

**Send every captured body.** Preserves eager access but repeats unnecessary initial input. Indexing trades that cost for explicit bounded reads; it cannot guarantee a cheaper completed report.

## Consequences

Unit tests cover index order, immutable capture, line endings, Unicode, complete-result limits, later findings, corruption, role guards, registration rollback and disposal. The installed headless Loader scenario reads four saved pages after the synthetic workspace file changes, reaches its final adverse finding, and retains original critic/Auditor evidence through the accepted report. Existing Detective snapshots include indexed dispatches and reader calls where needed.

The historical measured run contained no captured files, so this part has zero estimated saving there. Net price, extra calls and evidence quality still require the public real-model comparison. The coordinated v6 proposal retains budget and coverage accounting. No owner session data is needed.
