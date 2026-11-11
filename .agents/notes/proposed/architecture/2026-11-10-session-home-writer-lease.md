# Agent Note: One host writer per home and store

Status: proposed

English | [中文](2026-11-10-session-home-writer-lease.zh.md)

## Problem

[#51](https://github.com/Biyocon/biyocon-harness/issues/51) requires exclusive ownership before durable mutation or repair. The [JSONL backend](../../../../packages/session/session-persistence-jsonl/src/index.ts), [SQLite backend](../../../../packages/session/session-persistence-sqlite/src/index.ts) and [coordinator](../../../../packages/session/session-persistence/src/coordinator.ts) coordinate individual instances, not independent hosts. A JSONL-only lock also leaves home-sharing processes using other backends unprotected. The launcher warning cannot make the official desktop app honor a new lock.

## Proposal

### Host scope and primitive

The boot/host owns a lifetime lease on canonical DSH_HOME before mounting any writable home service, independent of persistence backend. Each durable backend additionally requires a host-owned store lease before publishing persistence, opening a session database, appending or repairing. JSONL uses its canonical root directory; SQLite uses the canonical directory containing its database file, deliberately serializing databases in that directory. An in-memory backend still cannot bypass ownership of a writable home. Different homes and store directories remain independent.

Use a generic acquire/close service with no Conductor import. The [shared boot](../../../../packages/boot/app-boot/src/index.ts) acquires home ownership before plugin startup; host launchers that bypass it must acquire the same service before home writes. Providers request store ownership from that host. When home and store are the same resource, reuse the host's connection; do not reopen the lock file. The process-local registry rejects another host or duplicate store provider before a second handle opens. Tests constructing providers directly mount this ownership explicitly with isolated homes.

Recommend a dedicated SQLite lock database per resource, `.session-writer-lease.sqlite`, using built-in [Node 22.19 DatabaseSync](https://nodejs.org/download/release/v22.19.0/docs/api/sqlite.html), rollback-journal mode, `PRAGMA busy_timeout=0` and a held `BEGIN EXCLUSIVE`. [SQLite transaction semantics](https://www.sqlite.org/lang_transaction.html) provide immediate contention refusal and OS-exit release. Keep the connection throughout ownership. After initial database creation, issue no writes, metadata updates, heartbeat, owner/PID records or journal-mode changes to the lock database; the held transaction alone is the signal. Session JSONL/Zstandard and SQLite data formats remain unchanged.

The lock file must never be opened by anything except its owning SQLite connection in that process. In particular, never use `open`, `readFile`, `fstat`, header probes, backup copies or a temporary descriptor for identity checks. Use only pathname `lstat`/`stat` for lock-file identity and link count. [SQLite's POSIX warning](https://www.sqlite.org/howtocorrupt.html#_posix_advisory_locks_canceled_by_a_separate_thread_doing_close_) explains why closing another descriptor for that file can release the process's locks. This prohibition covers helper threads and diagnostics, not just the lease helper.

A persistent lock file is coordination state, not proof of liveness. Never delete, rename, replace, migrate or reset it on acquisition/release. Validate database structure through the owning SQLite connection and reject unexpected journal mode or corruption. The lock database contains no session content, keys or prompts. A paused live process retains its lock indefinitely; no PID inference, timeout increase, retry or automatic stale takeover.

### Paths and best-effort network refusal

Resolve home through the existing home-path utility and store configuration once against startup cwd. Create absent coordination directories, then `realpath` the resources before choosing lock files. No durable home or session mutation may precede its lease; directory/lock initialization is the explicit exception. Symlink/junction aliases converge; comparisons respect case-sensitive filesystems. Reject lock-file symlinks/multiple hard links and hard-linked SQLite data files. Retain pathname-observed directory/file identities; a detected replacement invalidates further operations without silent reacquisition. Manual replacement while running remains unsupported.

Acquire home before mounting services, then store leases in deterministic order. Contention is nonblocking; any startup failure releases acquired leases only after all already-started operations drain. A second host never falls back silently to read-only or a different home.

The owner approves **best-effort**, not complete, network-filesystem detection. On Linux call [`fs.statfsSync(path).type`](https://nodejs.org/download/release/v22.19.0/docs/api/fs.html#fsstatfssyncpath-options) on each resolved resource and compare the unsigned filesystem type with the [kernel constants](https://github.com/torvalds/linux/blob/master/include/uapi/linux/magic.h): NFS `0x6969`; CIFS/SMB `0xFF534D42`, `0xFE534D42`, `0x517B`; FUSE `0x65735546`. Refuse all these types, including local-looking FUSE mounts. Inspection errors also refuse startup. On Windows reject UNC forms after `realpath`, including extended UNC paths. Network filesystems on macOS and mapped network drives are unsupported and may evade these checks. An unrecognized type or non-UNC spelling is not proof of local storage or working locks. Supported use is local filesystems validated on the OS matrix; no guarantee covers other remote filesystems or an application ignoring this protocol.

### Participating processes

All hosts capable of writing the home participate, including launches from an agent's bash tool. A different port, backend, transport or parent process grants no exemption. No host kills another owner or chooses a temporary home silently.

| Process while a web host owns the home | Decision |
|---|---|
| Web host | Own home and store leases until every writable service drains. Another web host using either resource is refused. |
| Headless CLI, including agent-bash launches | Refuse the inherited occupied home. Standalone operation requires an explicitly separate home/store; operations on the existing home use the active host's API instead. |
| ACP CLI, including agent-bash launches | The same refusal and explicit separate-home rule. ACP transport does not authorize another local writer. |
| [subagent-acp children](../../../../packages/subagent/subagent-acp/README.md) inheriting DSH_HOME | Refuse a shared-home child before launch/dispatch. Supported children require an explicitly configured, distinct home/store pinned across resume; parent/child coordination uses ACP, not a second backend into the parent's store. Do not copy home credentials or manufacture random resume identities. |
| SDK server | A standalone server owns its own leases and is refused on occupied resources. SDK clients targeting the existing host API acquire no writer lease and instantiate no backend. |
| [Python runtime](../../../../python/sdk-runtime/README.md) | Auto-spawning a server with the occupied inherited home is refused. Configure a separate home/store for an independent runtime, or use a supported client connection to the active host API. Do not presume an unimplemented attach mode exists. |
| Seeders and direct-backend tests | Use the owning host's persistence API or wait for its complete shutdown. Detached browser seed contexts and shared-home cross-port writers cannot bypass the lease. |

Implementation audits each launcher, environment inheritance and backend factory against this table. Remote clients that do not open a local home are not extra local writers; worker-thread children already inside the same host use its ownership rather than acquiring competing leases.

### Lifecycle and diagnostics

Keep ownership at boot/host scope rather than JSONL-provider scope. Both durable providers must prove host/store ownership before setup and participate in host shutdown. Stop admitting new operations, drain writes, repairs, direct reads with repair effects and active storage operations, close backend databases through the coordinator, and release store then home leases last. A failed drain never releases ownership while work remains live. Setup failure follows the same ordering. OS termination releases SQLite locks; a new owner performs existing crash recovery under its own lease.

Expected changes cover the generic ownership helper, shared boot/host lifecycle, both persistence providers, participating CLI/ACP/SDK/Python launch paths and seeders, owning README pairs, plus any demonstrated missing coordinator tracking. Default home resolution stays in home-paths. Record actual generic dependencies and implementation PR in the Conductor inventory where applicable. Core never imports Conductor; no agent-loop, model policy, session-event or Conductor-record change is proposed.

Refusal identifies only the selected resource and explains **“En anden proces bruger datamappen. En proces på pause beholder låsen. Luk den anden vært, eller vælg en separat datamappe.” / “Another process owns this data directory. A paused process retains the lock. Close the other host or choose a separate home.”** Never expose stored content, call a lock stale based on time, kill a process or claim protection from the official desktop app.

### Evidence and implementation test plan

The retained synthetic Windows/Node 24 probe confirms primitive-level contention, independent lock files, normal close and terminated-owner release. It does not prove host integration or cross-platform support; no owner home/app was used.

Use deterministic IPC barriers through real subprocess entry points on native Windows, Linux and macOS. Test exactly one acquisition winner, unchanged loser data, independent homes/stores, canonical aliases, shared-store collisions across homes/backends, same-process duplicates, delayed write/repair drain, setup failure and crash recovery. Exercise JSONL and SQLite plus every participant in the table, including bash-launched headless/ACP and inherited-home subagent-acp refusal. SDK/Python client cases must use the actual supported transport.

On Linux and macOS, acquire the lease, run every pathname identity/link/replacement check, then show another process is still refused while the first connection stays open. Instrument the helper to prove those checks never open the lock database through a separate descriptor; test the invariant after repeated checks. Verify post-creation immutability through the owning SQLite connection's executed operations and pathname size/mtime checks, without opening an auxiliary descriptor. Cover all listed Linux type values, statfs errors, Windows post-realpath UNC variants and documented unsupported cases. A suspended live owner still excludes a contender; resuming it does not create another owner.

Add keyless runnable-example refusal/restart snapshots with zero model calls by the refused host, focused coverage, built-provider smokes and doc-sync. Add a targeted macOS CI lane if the existing inventory does not run the required POSIX cases.

## Alternatives considered

**JSONL-provider ownership only.** Rejected: other backends and boot-time home services would escape the protocol. Host ownership plus store ownership covers both resource identities.

**PID file or heartbeat takeover.** Rejected: PID reuse and suspended writers make automatic deletion unsafe.

**Native flock/LockFileEx addon.** Revisit only if the SQLite primitive fails the platform tests; it adds native release maintenance.

**Complete network-drive detection.** Not promised. The approved recognizers refuse known types; unidentified remote filesystems remain unsupported.

## Acceptance criteria

No participating host/backend mutates durable state without the required ownership. Both providers and all process-table cases meet their stated decisions. Shutdown retains home/store ownership through complete drain. Linux/macOS identity checks preserve contention refusal without extra lock-file descriptors. The lock database is immutable after creation. Network refusal matches the approved best-effort policy; paused-owner diagnostics are explicit. Tests prove the supported local-filesystem cases on all three OSes. No stale takeover, format migration, private content or Conductor dependency enters the helper.

## Risks

Advisory locks cannot stop an uncooperative app or arbitrary filesystem writes. Undetected network storage, externally replaced files and unsupported filesystems remain outside the guarantee. Directory initialization changes lazy startup; SQLite stores sharing a directory intentionally serialize. Existing duplicate-backend tests, inherited-home subprocesses and launchers need deliberate conversion. The launcher warning remains necessary.
