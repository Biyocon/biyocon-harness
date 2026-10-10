# Agent Note: Conductor quality-command executor

Status: proposed

English | [中文](2026-10-10-conductor-quality-command-executor.zh.md)

## Problem

The Conductor runtime deliberately removes general shell access from every specialist, but its Headsman and Ralph instructions require implementation checks and Gate E requires independent Auditor verification. Specialists can currently inspect existing results but cannot reproduce configured tests, compilers, schema validators, or generators through Conductor. Adding an ordinary shell tool would let model output select an executable, arguments, and effects beyond the approved execution baseline.

## Proposal

`dsh-tool-conductor` owns an empty-by-default deployment catalog of quality commands. Each definition has an opaque id, a model-safe description, exact argv, permitted Headsman or Auditor stages, a canonical workspace-relative cwd, an optional write root, sandbox mode, timeout, output limit, and termination grace period. Shell interpreters and invalid path relationships fail at plugin load. Gate C selects only ids; the host resolves them to immutable definition hashes and records the catalog hash in the execution baseline. Selecting a command requires the separate `quality-execute` execution permission.

The spawn-in-process provider gains a trusted child-only tool-contribution capability. Workflow and Ralph carry the callback as host policy without serializing it to the worker program. The contribution is installed after ordinary child composition in the unpublished child scope, so it is neither a global tool-registry row nor subject to a name allowlist designed for inherited tools. Fork, ACP, and other out-of-process providers advertise no support and fail before starting a child.

The contributed `conductor_quality_check` accepts exactly `{ command_id }`. It resolves the Gate-C binding, invokes exact argv without a shell, requires a sandbox backend reporting full enforcement, and collects bounded output without a spill file. The durable `QualityExecutionRecord` contains identity, stage, gate, cycle, baseline and definition hashes, timing, exit facts, outcome, and stdout/stderr digests, but no command text or output body. Bounded diagnostics may be returned to the current specialist without entering the record.

Gate D requires fresh passing records for every Gate-D binding in the current cycle. Ralph rounds share the Headsman record sink and may produce that evidence, but Ralph owns no gate. Gate E starts a fresh Auditor and requires the Auditor's own fresh passing records for every Gate-E binding; Headsman or Ralph evidence cannot satisfy it. Resume rejects catalog or binding drift.

The sandbox policy covers filesystem effects only. This design makes no network-isolation claim and never grants commit, push, merge, release, publish, or deploy authority.

## Alternatives considered

- Granting Headsman or Auditor the general shell tool was rejected because model output would choose unreviewed commands and arguments.
- Accepting raw command text in the private tool was rejected because it would bypass deployment review and immutable Gate-C bindings.
- Treating prior external results as sufficient was rejected because Gate D and Gate E require current-baseline evidence, and Gate E must be independent.
- Letting Ralph or Auditor decide a gate was rejected because Conductor is the sole owner of workflow state and gate decisions.
- Allowing partial sandbox enforcement was rejected because a declared file policy that the host cannot fully enforce must fail closed.

## Acceptance criteria

- The catalog validates and freezes exact command definitions, rejects shell interpreters, duplicate ids, invalid paths, Auditor writes, and missing write roots.
- The private tool rejects unknown ids, extra input fields, stale bindings, unauthorized stages, missing execution permission, and partial or unavailable sandbox enforcement before command execution.
- Execution uses exact argv without a shell, applies configured cwd and filesystem policy, bounds time and collected output, leaves no spill path, and classifies timeout, signal, runner, denial, and ordinary exit failures.
- Durable records contain only approved execution facts and digests; persistence rejects unknown fields, cross-run references, hash drift, invalid timing, and unknown cited evidence.
- Gate D accepts Ralph-produced Headsman evidence when it is fresh and passing; Gate E requires a distinct fresh Auditor run and cannot reuse Gate-D evidence.
- Workflow, Ralph, and subagent providers preflight the trusted child-tool capability without exposing the callback to model or worker-script input.
- Focused Conductor tests, typecheck, documentation synchronization, and lint pass.

## Risks

- Hosts without a fully enforcing sandbox backend cannot run quality commands; this is an intentional fail-closed availability cost, especially on Windows configurations with partial enforcement.
- A deployment catalog is executable host policy. Incorrect definitions can still run an unintended reviewed argv, so deployment review remains required.
- A workspace-write backend may need backend-owned temporary files outside the configured product write root to launch the confined process; those files are not product-write authority.
- Filesystem confinement does not prevent network access. Commands needing network isolation require a different execution environment or capability provider.
