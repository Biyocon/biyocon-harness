# Agent Note: Conductor quality-command executor

Status: implemented

English | [中文](2026-10-10-conductor-quality-command-executor.zh.md)

## Problem

The Conductor runtime removes general shell access from every specialist, but Headsman and Ralph require implementation checks and Gate E requires independent Auditor verification. Specialists must reproduce configured tests, compilers, schema validators, or generators without letting model output choose executable arguments, write authority, network access, or release actions.

The model-facing Conductor call is not an authority channel. An owner label, proposed path list, quality-command selection, or closeout record produced by the model cannot grant writes, subprocess execution, commit, push, merge, release, publish, or deploy authority.

## Decision

`dsh-tool-conductor` owns an empty-by-default deployment catalog of quality commands. Each definition has an opaque id, a model-safe description, exact argv, permitted Headsman or Auditor stages, a canonical workspace-relative cwd, an optional write root, an explicit filesystem effect, fixed `network: deny` and `external: none` effects, timeout, output limit, and termination grace period. Invalid path and effect relationships fail at plugin load. Gate C selects only ids; the host resolves the selected definitions and records their hashes in the execution baseline. Missing, malformed, duplicate, or unknown command-id selections produce a durable blocker without persisting the rejected report. Changes to unselected catalog entries do not invalidate a run.

After Gate C produces a structurally valid baseline, the existing approval service owns the effectful authorization. The approval identifies the exact baseline hash, canonical allowed and excluded paths, selected command ids and definition hashes, and derived filesystem, quality, and external effects. Rejected, cancelled, or unavailable approval starts no write-capable child and no quality subprocess. `authority.owner` remains attribution only, and the model-facing tool accepts neither execution permissions nor closeout authorization. The core `closeRun` API remains available to a host-owned channel after Arbiter GO; the model-facing tool leaves the run at `awaiting_authorization`.

The spawn-in-process provider contributes the private `conductor_quality_check` only to a fresh child. Workflow and Ralph carry the callback as host policy without serializing it to the worker program. Each Ralph round receives the approved baseline, acceptance criteria, constraints, and its bound Gate-D command ids and model-safe descriptions in its logged objective. Fork, ACP, and other out-of-process providers advertise no support and fail before starting a child.

The private tool accepts exactly `{ command_id }`. It resolves the Gate-C binding, invokes exact argv without a model-supplied shell string, requests filesystem confinement plus network denial, requires the sandbox backend to report full enforcement for that concrete policy, and collects bounded output without a spill file. The durable `QualityExecutionRecord` contains identity, stage, gate, cycle, baseline and definition hashes, timing, exit facts, outcome, and stdout/stderr digests, but no command text or output body. Bounded diagnostics may return to the current specialist without entering the record.

The Conductor record has an explicit pre-release format version, an append-only baseline history, one active baseline, and one matching execution authorization. Every Gate C pass and later gate attempt records its execution-baseline hash. Scope or plan rework clears the active baseline and authorization while retaining historical baselines, gate records, specialist reports, and quality executions for audit. Historical evidence remains parseable but cannot satisfy a new baseline or gate cycle.

Quality evidence ids are validated before a specialist report is persisted. Each id must be unique and belong to a host-produced record from that exact dispatch. Unknown, historical, foreign, or duplicate ids escalate without persisting the invalid model report; host-produced execution records from the dispatch remain durable. Gate D requires fresh passing records for every Gate-D binding in the current cycle. Ralph may produce Headsman evidence but owns no gate. Gate E requires the fresh Auditor dispatch's own passing records; Headsman or Ralph evidence cannot satisfy it.

## Alternatives considered

- Granting Headsman or Auditor a general shell tool was rejected because model output would choose unreviewed commands and arguments.
- Accepting raw command text in the private tool was rejected because it would bypass deployment review and immutable Gate-C bindings.
- Treating a model-provided owner label, path list, execution permission, or closeout object as authority was rejected because the model cannot authenticate mandate ownership.
- Rejecting executables by name was rejected because wrappers and general-purpose runtimes bypass a denylist; exact deployment argv, host approval, filesystem confinement, and network denial own enforcement.
- Hashing the entire catalog was rejected because an unrelated unselected definition would invalidate an otherwise unchanged baseline; selected definition hashes bind every executable command.
- Discarding quality history on rework was rejected because a durable run must preserve the evidence and decisions that led to rework.
- Allowing partial sandbox enforcement was rejected because a backend that cannot enforce the requested filesystem and network policy must fail closed before spawn.

## Verification

- Catalog validation freezes exact command definitions, includes the effect profile in each definition hash, rejects duplicate ids, invalid paths, Auditor writes, and missing write roots, and permits shell executables only as deployment-owned exact argv.
- Gate C asks through the approval service only after the baseline is structurally valid. Denied, cancelled, or unavailable approval produces a durable blocker and starts no write-capable specialist or quality subprocess.
- The model-facing schema omits write, quality-execute, and closeout authority. Capability filters and guards derive from the persisted baseline authorization.
- Seatbelt enforces complete network denial. Bubblewrap isolates IP networking with `--unshare-net` but leaves mounted host Unix-domain sockets reachable; Bubblewrap, Landlock, and Windows ACL therefore report partial enforcement for that policy, so the quality executor fails before spawn. Ordinary Bash, PowerShell, and terminal consumers request explicit network inheritance.
- Execution uses exact argv, applies configured cwd and filesystem policy, bounds time and output, leaves no spill path, and classifies timeout, cancellation, signal, runner, denial, unavailable-sandbox, and ordinary exit failures.
- Persistence rejects unknown fields, obsolete record versions, cross-run references, baseline-history drift, invalid timing, and invalid evidence relations. Scope and plan rework round-trip through serialize, parse, and resume while preserving historical evidence.
- Unknown, historical, foreign, and duplicate quality evidence ids are rejected before specialist-report persistence. Host records produced during the failed dispatch remain available for audit.
- Gate D accepts fresh Ralph-produced Headsman evidence; Gate E requires a distinct fresh Auditor dispatch and cannot reuse Gate-D or prior-baseline evidence.
- The assembled keyless scenarios exercise host approval, selected binding hashes, direct Headsman or fresh Ralph execution, independent Gate-E execution, durable baseline lineage, and the final `awaiting_authorization` state. The Ralph variant pins the worker's model-visible baseline and command ids and requires Headsman to cite that worker's host-produced evidence without rerunning its command.

## Consequences

- Quality commands are unavailable on hosts that cannot fully enforce both their filesystem policy and network denial. Built-in Linux Bubblewrap/Landlock and Windows ACL compositions therefore fail closed for quality execution; Seatbelt or an explicitly asserted stronger custom runner can satisfy the policy. Ordinary shell and terminal calls retain explicit network inheritance.
- A deployment catalog remains executable host policy. Deployment review owns the exact argv and effect declaration, while runtime approval binds the selected definitions to one run and baseline.
- A workspace-write backend may need backend-owned temporary files outside the configured product write root to launch the confined process; those files are not product-write authority.
- Existing pre-release Conductor records without the current record-format version are rejected rather than migrated.
- Arbiter GO never closes the run through model input. A host-owned caller records any authorized external action and its outcome through the core closeout API.
