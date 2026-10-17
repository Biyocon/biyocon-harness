# @deepseek-ai/dsh-sandbox-local

English | [中文](README.zh.md)

Local implementation of the [`dsh-sandbox`](../sandbox/) seam. It selects and caches one platform runner: Linux prefers a working `bwrap` then Landlock; macOS uses Seatbelt; Windows uses the ACL restricted-token runner. Multiple candidates are probed in order, while a sole candidate is selected directly.

The package root exports the default and named `LocalSandboxProvider` plugin and `Config`; platform profile builders stay internal.

Unsupported platforms and unusable runners fail closed with `SANDBOX_UNAVAILABLE`; execution never silently falls through unconfined. Each wrap carries structured runner-failure rules so consumers can distinguish a broken sandbox from a command failure. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection rationale and profile differences.

Policy is per call; the provider stores only the mechanism and cached runner verdict. Each wrap reports enforcement completeness for the concrete file and network policy plus backend-specific denial signatures and runner-failure rules. Bubblewrap adds `--unshare-net`, which isolates the child IP namespace but leaves host Unix-domain sockets reachable through the read-only host mounts, so `network: deny` reports `partial`. Seatbelt adds `(deny network*)` and reports full network denial. Landlock and the Windows ACL runner cannot enforce network denial, so their deny policies also report `partial` even when file enforcement is otherwise full. Landlock requires exit 125 and a `landlock-run:` fatal line after excluding only the exact partial-enforcement notice; a notice with child exit 1, 2, or 125 remains a child outcome. Bubblewrap and Seatbelt remain signature-only because neither public contract reserves a launcher-failure status. Consumers spawn the returned argv directly, so a missing or unexecutable runner is an out-of-band spawn failure while a successfully launched child exit 126 or 127 remains ordinary. `runnerCommand` skips probes, receives the bwrap-compatible profile, and requires one or more non-empty, single-line, case-insensitive `runnerFailureSignatures` entries for the custom runner's fatal dialect. Its `network: deny` result defaults to partial; `runnerNetworkDenyEnforcement: full` is an explicit operator assertion that the runner adds complete network denial beyond the appended `--unshare-net` profile. `probeTimeoutMs` bounds functional probes. The [sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-07-06-sandbox.md) owns selection and failure semantics.

The Seatbelt profile is allow-default with `(deny file-write*)` plus write allow-lists, so exactly the mode's promised file effects are governed: `read-only` grants the `/dev/null` literal alone; `workspace-write` adds the workspace root, `/tmp`, and the per-user darwin temp dir (`os.tmpdir()` — the platform's real temp area for mkstemp-family tools), every root canonicalized because Seatbelt matches resolved paths (`/tmp` IS `/private/tmp`). Apple marks the `sandbox-exec` CLI deprecated but ships it on every macOS; the functional probe is what fails closed if that ever changes.

The Windows rung keeps one deterministic write SID and standing ACE per workspace, but gives every live session/workspace pair a random private temp directory with a distinct SID and revocable ACE. Sessions sharing a workspace therefore share its intended write authority without inheriting one another's temp authority. A fresh provider always chooses a new temp path and SID, so crash residue cannot block or authorize a resumed session; agentless calls receive the same per-invocation isolation from the runner. A workspace equal to or containing the platform temp root fails before any ACL mutation because its inheritable workspace ACE would otherwise reach every private temp child.

[`@deepseek-ai/node-addon-landlock-run`](https://www.npmjs.com/package/@deepseek-ai/node-addon-landlock-run) supplies the platform launcher, functional probe, and CLI argument vocabulary. This provider owns only mode-to-grant mapping and runner selection. Keeping path resolution and probe parsing with the versioned binary prevents contract drift.

```yaml
- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
```

Consumers: [`@deepseek-ai/dsh-bash-sandbox`](../../shell/bash-sandbox/); see [the acp-agent example](../../../examples/acp-agent/) for the runnable default composition.

## Model Experience

Indirectly, through [`dsh-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`dsh-tool-bash`](../../shell/tool-bash/README.md), which render this provider's enforcement and denial facts while the [`dsh-sandbox`](../sandbox/README.md) seam owns the `SANDBOX_UNAVAILABLE` text and runner selection and profiles stay outside context.

#### KV Cache effect

No direct invalidation; the named consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

- **Windows ACL enforcement is partial** — the restricted token must retain Everyone for process initialization, so external objects granting Everyone write access remain writable; NTFS hard links also alias one file object across workspace and external paths. The provider reports `enforcement: 'partial'` rather than overstating that boundary as full.
- **Landlock may be partial** — older supported kernel ABIs confine only the access classes they expose, reported as `enforcement: 'partial'` rather than overstated as full.
- **Bubblewrap does not deny every network operation** — `--unshare-net` isolates IP networking, but mounted host Unix-domain sockets remain reachable; requests with `network: deny` report partial enforcement.
- **Landlock and Windows ACL cannot deny networking** — requests with `network: deny` report partial enforcement and must be rejected by consumers that require complete denial.
- **Seatbelt depends on deprecated `sandbox-exec`** — macOS still ships it, but this provider cannot replace or probe that private policy engine if Apple removes it.
- **Runner selection is cached for the provider lifetime** — installing, removing, or repairing a runner requires reloading the plugin before selection changes.
- **`runnerCommand` is an operator assertion** — a configured custom runner skips functional probes. Its network-denial enforcement defaults to partial; selecting `runnerNetworkDenyEnforcement: full` asserts that it adds a stronger mechanism denying all network operations beyond the appended bwrap-compatible profile. If the runner is itself a Bash script, its interpreter startup runs before that script applies confinement.
