# Agent Note: One session writer per home and store

Status: proposed

English | [中文](2026-11-10-session-home-writer-lease.zh.md)

## Problem

[#51](https://github.com/Biyocon/biyocon-harness/issues/51) requires an exclusive host owner before session append or repair. The [JSONL backend](../../../../packages/session/session-persistence-jsonl/src/index.ts) resolves its root once and its [coordinator](../../../../packages/session/session-persistence/src/coordinator.ts) drains writes before an optional backend `close()`, but coordination is instance-local. Two hosts can still mutate the same store. The launcher warning cannot protect against a second participating host or make the official desktop app honor a new lock.

## Proposal

### Scope and primitive

Require a lifetime lease for both the resolved Harness home and the configured session root. Home identity prevents two hosts using different session subdirectories under one home; store identity prevents two homes pointing at one shared session directory. Different homes with different stores remain independent. This protects participating session writers, not settings, credentials or an application that ignores the lease.

Recommend a dedicated SQLite lock file per resource with `PRAGMA busy_timeout=0` and a held `BEGIN EXCLUSIVE` transaction in rollback-journal mode. Use built-in [Node 22.19 DatabaseSync](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html), already used elsewhere in the repository, without depending on newer APIs. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html) and [OS-backed locking](https://www.sqlite.org/lockingv3.html) supply contention and process-exit release. Keep connections open for the entire writer lifetime; no recurring timer, PID liveness inference, timeout increase, retry or automatic stale-lock deletion. Session storage remains JSONL/Zstandard and its record format does not change.

Use `.session-writer-lease.sqlite` inside each canonical directory; if home and store are identical, acquire once. A persistent lock file is coordination state, not proof that a writer is alive. Never delete, rename, replace, migrate or reset it during normal acquisition or release. Reject malformed databases and unexpected journal modes explicitly. Closing or rolling back the connection releases ownership. The lock database contains no session content, keys, prompts or owner PID metadata.

### Canonical paths and acquisition

Resolve home through the existing home-path utility and resolve the store relative to the startup cwd once. Create absent directories, then `realpath` each root before selecting its lock file. Directory creation and lock files may precede ownership, but no session log or repair may change before both leases succeed. Symlink/junction aliases must converge on the same resource. Normalize platform path comparison without lowercasing paths on case-sensitive filesystems; filesystem identity, not a hash of the supplied path, determines exclusivity.

Acquire distinct resources in a deterministic order. Each attempt fails immediately on busy/locked and closes every connection already acquired if a later resource fails. Add a process-local registry keyed by canonical resource identity so a duplicate backend is rejected before it opens another SQLite handle to an owned lock. Reject lock-file symlinks and multiple hard links, retain file/directory identities, and fail subsequent operations if an observed replacement or root change invalidates ownership. Do not silently reacquire while old writes may remain in flight.

Support local filesystems whose locking is verified on the supported OS matrix. SQLite explicitly documents [filesystem and lock-file replacement hazards](https://www.sqlite.org/howtocorrupt.html). Network filesystems are outside the guarantee. Before implementation approval, specify the platform checks for remote or unsupported roots and their explicit refusal; path spelling alone is insufficient for mounted shares. Manual replacement of the lock file or its directory while a host runs is unsupported and must not be described as safe.

### Lifecycle and package ownership

Implement a generic session lease helper with an explicit acquire/close API, without a Conductor import. The JSONL provider acquires synchronously before publishing a writable persistence service or constructing its write coordinator; invalid config or setup failure releases acquired resources. Bind the lease to the exact provider instance. There is no implicit read-only fallback for a second host; inspections can use the active host's API.

On teardown, stop admitting new operations, drain writes, repairs and active storage operations, then release the lease through the coordinator's existing backend `close()` ordering. Verify that all direct API operations participate in this drain; if the current coordinator omits one, make the smallest general lifecycle correction. A rejected drain must not release the lease while any operation is still live. An OS-terminated process releases its SQLite locks; a new owner may then run existing crash recovery under its own lease. A paused but live process keeps ownership indefinitely.

Expected implementation files are a new generic helper under `packages/session/`, JSONL provider Config/acquisition/close, owning README pairs, and only any demonstrated missing operation tracking in the persistence coordinator. Default home resolution stays in `home-paths`. Register actual shared dependencies and PR number in the Conductor inventory where applicable. No agent-loop, model, tool-policy, session-event or Conductor-record change is planned.

Tests and seeders that currently instantiate a second backend against a live store must use the host's persistence API or await complete disposal first. In particular, the browser scaffold's detached seed context must not bypass the lease. Shared-home cross-port tests must expect refusal for a second writer rather than simultaneous write access. Diagnostics state that the selected home/store is already in use, offer closing the other Biyocon host or choosing a separate home, and never kill it or expose stored content.

### Evidence and implementation test plan

An uncommitted synthetic probe on Windows/Node 24 confirmed: another process is refused, a different lock file remains independent, and acquisition succeeds after normal close and terminated-owner exit. This is primitive-level evidence, not proof of the integration or other platforms. No owner home or app was used.

Implementation needs deterministic IPC barriers through real subprocess entry points: simultaneous acquisition has exactly one winner; the loser changes no session artifact; separate homes/stores work concurrently; canonical aliases collide; separate homes sharing a store collide; same-process duplicates fail; normal close holds ownership until delayed writes/repair finish; crash termination permits existing tail recovery; and setup failure releases an earlier lease. Cover corrupt/replaced lock files, denied filesystem access and unsupported remote roots without takeover. Snapshot a real runnable example's refusal and successful restart keylessly, checking zero model calls by the refused host. Run focused unit coverage, built-provider smokes, doc-sync and the cross-process scenarios on native Windows, Linux and macOS; add a targeted macOS lane if the existing workflows do not execute them.

## Alternatives considered

**PID file or exclusive directory with stale-time recovery.** A PID can be reused, and a suspended live writer can outlast a heartbeat. Removing its lock would permit concurrent writers; refusing stale files forever needs manual recovery after every crash.

**Native flock/LockFileEx addon.** It can provide lifetime locks but adds native builds and platform release maintenance. Revisit if the SQLite primitive or required local-filesystem detection cannot meet the tests.

**Home lock only.** Different homes can still select one session root. **Store lock only** permits two hosts sharing a home when their stores differ. The two-resource rule implements both identity requirements.

## Acceptance criteria

No session mutation occurs before both leases are held. Shutdown stops admitting operations and finishes previously admitted work while retaining ownership. Only one participating provider owns a canonical home/store; a second instance is explicitly refused without modifying logs. Every implementation test above has evidence on its stated platforms, including macOS. No retry, stale takeover, format migration, leaked content, or Conductor dependency enters the helper. Review must resolve remote-root detection and prove the full storage-operation drain before implementation is accepted.

## Risks

SQLite and filesystem locking depend on the underlying platform; a file path is not proof of correct lock semantics. Unexpected lock-file replacement can break cooperation and must fail visibly when observed. Existing tests assume duplicate backend access and require deliberate conversion. Creating coordination directories at startup changes the backend's lazy-root behavior and must be documented. The official desktop app remains an uncooperative writer, so the launcher warning remains necessary.
