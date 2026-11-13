# Agent Note: Isolated Conductor quality rehearsal

Status: proposed

English | [中文](2026-11-13-conductor-isolated-quality-rehearsal.zh.md)

## Problem

An all-role implementation test needs registered commands, real independent quality executions and host approval. The shipped empty catalog cannot be repaired by an owner's free-text answer. A test must not alter the production preset, use private sessions or weaken sandbox enforcement to obtain a green result.

## Proposal

Run this rehearsal as a separate testing track, never a dependency of R1 in the [shared-view roadmap](../architecture/2026-11-13-conductor-shared-process-view-and-rollout.md). This note is a plan, not authorization to run providers or change an active app.

### Isolation and exact command

Use a dedicated worktree under `C:/Users/Biyocon/worktrees/conductor-quality-rehearsal`, a new task-owned `DSH_HOME` under that worktree, an isolated synthetic workspace and only `127.0.0.1:3090`. Check port ownership before boot; if occupied, stop preparation rather than kill its process. Never touch port 10822, the owner's `~/.dsh`, retained desktop session files or existing PI sessions. Disable telemetry and inherited provider credentials for keyless stages. Only task-owned processes may be stopped after evidence/flush; retain artifacts for review rather than delete them.

The sole catalog definition lives in the test profile's `cordis.patch.yml`, under its single test-owned `tool-conductor` Config. Assemble that dedicated profile using the existing [quality snapshot composition](../../../../examples/headless-agent/conductor.cordis.snapshot.yml) as a structural reference, with the Web surface and ordinary host UI approval. Do not edit the shipped preset or add a competing copy of its Conductor mount. Because a host-profile patch does not automatically patch a standing agent-preset subtree, first prove by real Loader composition that the selected test session and children see this exact scoped row; reject duplicate mounts or a still-empty effective catalog before any model work. This test-only assembly does not qualify packed preset installation.

Configure exactly one command as follows; `!!js` resolves the host's pinned Node executable before the catalog hashes its exact argv. Record the Node version/path/hash and reject drift. The active host listener's executable was resolved read-only on 2026-11-13 to Node 24.13.0; that exact binary accepts `--test-isolation=none`, demonstrated by a synthetic passing test (exit 0) and intentionally failing assertion (exit 1). The argv below therefore remains unchanged. [Node 24.13.0 documents](https://nodejs.org/download/release/v24.13.0/docs/api/cli.html#--test-isolationmode) the rename from `--experimental-test-isolation` in 23.6.0. This is a pinned-host result, not blanket support for every version allowed by `engines`; check each chosen host before hashing the command, especially older 22.x hosts. No shell, additional arguments or network are permitted.

Disable test-runner process isolation to keep this single synthetic test in the already confined command process, without adding Node's default per-file child processes to lifecycle/evidence accounting. This does not weaken the OS sandbox or itself prohibit subprocesses: read-only filesystem confinement alone is not proof of a process-spawn denial. The real confinement preflight remains mandatory; the flag smoke does not qualify it.

```yaml
qualityCommands:
  - id: selftest-node
    modelSafeDescription: Run the synthetic arithmetic self-test without writes or network.
    argv: [!!js "process.execPath", --test, --test-isolation=none, conductor-selftest/selftest.test.mjs]
    cwd: .
    allowedStages: [headsman, auditor]
    sandboxMode: read-only
    timeoutMs: 5000
    maxOutputBytes: 8192
    graceMs: 250
```

These are all required [QualityCommandConfig](../../../../packages/conductor/tool-conductor/src/quality-catalog.ts) fields. The remaining optional field, `writeRoot`, is deliberately absent: read-only mode rejects it, and Auditor requires read-only confinement. Hash the resolved command; Gate C binds that definition and required D/E gates. Headsman and Auditor each invoke `conductor_quality_check` by id; neither supplies command text or forged evidence.

The synthetic task implements a tiny arithmetic module in `conductor-selftest/`; the predeclared Node test checks its actual behavior, including a failing negative control. Integrator documentation goes in `docs/`, consistent with its current path guard. Propose only those two write roots and exact exclusions in the fresh test mandate; the owner reviews the exact baseline at Gate C. This is a new synthetic scope, not an amendment to an existing private run. A printed list of roles does not prove dispatch or functionality.

### Keyless preflight and evidence

First use a loopback deterministic provider fixture and the real composed services. Prove the effective catalog, contribution-capable child provider, original root ownership, host approval display/binding, stale/rejected approval behavior and separate file-tool permission where applicable. For actual quality execution require the real selected sandbox to report full enforcement for the exact read-only/network-deny policy. A test wrapper merely reporting full enforcement is not OS sandbox proof. If native enforcement is partial/unavailable, record `sandbox-unavailable`, keep the run blocked and spend nothing; any isolated alternative host needs its own qualified setup.

Run the self-test to real exit 0 separately in D and E, capturing bounded output digests and fresh evidence ids tied to run, child, stage, cycle, baseline and definition. Reject wrong id, extra argv, altered definition, absent evidence, stale baseline or cross-run reuse; a deliberate failing assertion must not pass. Match actual dispatches to all seven specialist roles and render the corresponding UI. Reload/restart must preserve receipts without repeating execution. No session content or secrets enter logs/fixtures; fixtures are synthetic. These checks are planned, not claimed passed.

### Consumption estimate and paid-run stop condition

Current planning and keyless rehearsal have a maximum provider charge of **USD 0**. Do not load a real credential for them. A later paid attempt requires separate explicit owner approval of route, model, data, counters and maximum; never infer approval from this note or Gate C.

For planning only, estimate 20 model attempts, 100,000 uncached input and 10,000 output tokens, including reasoning. Illustrative bounded-cost envelope, enforceable only under (a): 32 actual attempts including retries, 500,000 input and 50,000 reasoning-inclusive output tokens, with no billed web tools. Using official DeepSeek V4 Pro peak prices of USD 1.32/M uncached input, 0.044/M cache-read and 3.96/M output, verified on 2026-11-13, the all-uncached estimate is USD 0.1716 and envelope USD 0.858; proposed owner spending ceiling is USD 1.00. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) is an illustrative route-specific calculation, not evidence that the rc.7 provider currently supports that model. Confirm the actual route and current tariff before approval; cache hits change price rather than eliminate tokens, and reasoning is not charged twice.

The owner must explicitly choose one paid-phase policy; no choice or spending approval is recorded by this proposal:

- **(a) Wait for a hard bound.** Wait for the separately reviewed v6 reservations/budgets under [#109](https://github.com/Biyocon/biyocon-harness/pull/109) to be implemented and qualified for the exact route, or an equivalent qualified hard host/provider control. Count actual attempts including retries, bound input and remaining output, and refuse dispatch on unknown usage or insufficient headroom. A v6 design merge alone is not implementation evidence.
- **(b) Explicitly accept one configuration-limited attempt.** Only if the owner separately accepts the absence of a per-run monetary guarantee, configure `maxReworkPerGate: 1`, `maxOwnerReassessmentsPerGate: 1`, and `maxRalphRounds: 0` in the isolated test profile, admit one fresh synthetic run, remove web/search/fetch tools and disallow external billed services. These values are valid for current v5 but limit stage rework/reassessment/Ralph rounds, not every model step, tool turn or provider retry. Use the approximately USD 0.17 estimate and USD 1.00 proposed stop threshold; the 32-attempt/token envelope above is planning arithmetic, not an enforced v5 maximum. Observe usage and stop at the first unexpected charge, usage report or exhausted threshold; do not auto-retry or restart.

For (b), verify the prepaid DeepSeek balance immediately before the separately approved attempt and retain its evidence privately, never in the repository or shared coordination files, disable automatic top-ups, and exclude competing account spend. The balance is an external account constraint, not a run-specific code guarantee or automatically a USD 1 limit: a larger balance exposes more funds. Any dedicated allocation or account change requires the owner's authorization. The owner must approve the actual potential exposure; if it cannot be established, do not start. Observation/stop latency and in-flight usage can exceed the threshold, and stopping cannot undo charges. Never describe this option as a hard cap or negligible measured risk.

Until the owner selects (a) or (b) and separately approves the exact route, data and spending conditions, the paid phase remains blocked at USD 0. Choosing (b) is a documented risk acceptance for this one rehearsal, not a change to runtime security or a general spending policy. Keyless P03/R8 evidence can proceed under either option; only a requested live-model supplement waits for this decision. Do not implement v6 or a limiter in this documentation task.

## Alternatives considered

**Change the production catalog.** It expands deployment authority and touches user state; keep the command only in the isolated profile.

**Fake full sandbox enforcement.** It may test executor plumbing but cannot qualify confinement; retain it only as a separately labelled lower-layer fixture, never the preflight pass.

**Run paid before an owner choice.** It can pay for a predictable setup failure and lacks a qualified cumulative cap. Complete keyless setup first; require either qualified hard bounds or explicit one-run risk acceptance.

## Acceptance criteria

The written setup names home, workspace, port, profile, all command fields and immutable argv. Real composition proves one intended catalog; full-enforcement/approval negatives, real independent D/E execution, role lineage and no-replay checks have explicit receipts. The paid stage remains unstarted until its independent authorization and chosen (a)/(b) conditions are demonstrated. Option (b) explicitly documents that its threshold is not guaranteed. Keyless acceptance is separate from any live supplement. This track cannot hold R1 hostage.

## Risks

The packaged preset and profile-level mounts are different scopes; a catalog shown in a file may not reach the actual child. Native Windows confinement may refuse the required policy. Provider/model limits and accounting may prevent (a), while (b) can exceed its monitored threshold. Surface each as a blocker rather than silently switching composition, weakening policy or billing an uncontrolled attempt. The [quality/owner runtime decisions](../../implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md) and portable installation proposal remain active; this rehearsal supersedes no implemented guarantee.
