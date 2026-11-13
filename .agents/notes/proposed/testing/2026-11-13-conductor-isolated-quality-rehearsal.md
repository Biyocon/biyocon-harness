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

Configure exactly one command as follows; `!!js` resolves the host's pinned Node executable before the catalog hashes its exact argv. Record the Node version/path/hash and reject drift. No shell, additional arguments or network are permitted.

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

For planning only, estimate 20 model attempts, 100,000 uncached input and 10,000 output tokens, including reasoning. Proposed maximum envelope: 32 actual attempts including retries, 500,000 input and 50,000 reasoning-inclusive output tokens, with no billed web tools. Using official DeepSeek V4 Pro peak prices of USD 1.32/M uncached input, 0.044/M cache-read and 3.96/M output, verified on 2026-11-13, the all-uncached estimate is USD 0.1716 and envelope USD 0.858; proposed owner spending ceiling is USD 1.00. [Official pricing](https://api-docs.deepseek.com/quick_start/pricing/) is an illustrative route-specific calculation, not evidence that the rc.7 provider currently supports that model. Confirm the actual route and current tariff before approval; cache hits change price rather than eliminate tokens, and reasoning is not charged twice.

The current v5 run budget does not enforce that cumulative envelope. Before any paid dispatch, qualify a host/provider reservation or equivalent hard spending control that counts every attempt and safely bounds request input and remaining output. Unknown usage or insufficient headroom refuses further dispatch. A manual counter, estimate, timer or kill-after-spend is not a guaranteed maximum. Without qualified enforcement and owner approval the paid phase remains blocked at USD 0; do not implement v6 or invent a limiter inside this documentation task.

## Alternatives considered

**Change the production catalog.** It expands deployment authority and touches user state; keep the command only in the isolated profile.

**Fake full sandbox enforcement.** It may test executor plumbing but cannot qualify confinement; retain it only as a separately labelled lower-layer fixture, never the preflight pass.

**Run paid first.** It can pay for a predictable setup failure and has no proven cumulative cap; qualify keyless setup and bounded cost first.

## Acceptance criteria

The written setup names home, workspace, port, profile, all command fields and immutable argv. Real composition proves one intended catalog; full-enforcement/approval negatives, real independent D/E execution, role lineage and no-replay checks have explicit receipts. The paid stage remains unstarted until both its independent authorization and hard maximum are demonstrable. This track cannot hold R1 hostage.

## Risks

The packaged preset and profile-level mounts are different scopes; a catalog shown in a file may not reach the actual child. Native Windows confinement may refuse the required policy. Provider/model limits and accounting may prevent a guaranteed paid maximum. Surface each as a blocker rather than silently switching composition, weakening policy or billing an uncontrolled attempt. The [quality/owner runtime decisions](../../implemented/feature/2026-10-30-conductor-owner-escalation-resumption.md) and portable installation proposal remain active; this rehearsal supersedes no implemented guarantee.
