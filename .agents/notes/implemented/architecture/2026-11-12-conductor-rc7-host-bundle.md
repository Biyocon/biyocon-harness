# Agent Note: Conductor rc.7 host bundle

Status: implemented

English | [中文](2026-11-12-conductor-rc7-host-bundle.zh.md)

## Problem

The CLI's Conductor preset copy and the base bundle's unconditional projection mount prevent independent Conductor installation. Removing either without replacing its installed resources and host registrations can hide existing runs or prevent session creation.

## Decision

The optional `conductor-host-rc7` bundle owns the host-wide Conductor mount and a generated preset tree. `conductor-presets` owns the two authored preset files and preparation code. Its literal allowlist reads 27 canonical assets without traversing run directories. The generated tree is committed so source startup, tests and static checks work before prepack. Static CI and doc-sync verify the exact allowlist and canonical SHA-256 without generating files; the npm tarball check independently verifies the packed bytes. This trades a generated git projection for independence from preparation order; canonical sources remain the sole authored inputs. Build and source preparation share atomic publication and fail-closed behavior from the [source-launch decision](../bug-fix/2026-11-01-conductor-source-launch-assets.md); those guarantees remain active. The [static role-profile decision](../feature/2026-10-24-conductor-role-profile-assets.md) retains image associations and relative metadata. CLI generation and the CLI preset copy are replaced by package-owned resources.

The generic rc.7 `dsh.bundle.presetRoot` declaration resolves a package-relative real directory. Escapes and non-directories fail before mount. Only explicit profile layers supply trusted roots; dependencies do not. The CLI combines its own root and declared bundle roots with system trust, forcing every patch-configured root to user trust. Patch roots cannot cause system/system duplicate-id failures. Discovery rejects duplicate ids across every system root, even behind a user-root shadow.

Biyocon explicitly selects the host bundle for new profiles. A generic installation-supplied extraction migration adds it once to existing profiles containing base and records its identity. This preserves custom profile rows and existing session access while respecting later explicit opt-outs. The core contains no Conductor imports or migration names. Both Conductor projections are registered by the bundle before replay; existing strict record parsing is unchanged.

## Alternatives considered

**Keep the CLI copy or the base mount.** Either keeps Conductor mandatory and leaves two installation owners.

**Append the bundle on every boot.** It prevents a deliberate opt-out. A recorded one-time migration preserves existing behavior without continually undoing user configuration.

**Copy whole canonical directories.** It can ship unlisted or private files. Literal paths and tarball verification make the publication set explicit.

## Consequences

The bundled preset and existing unavailable-run replay are tested through actual Loader composition and runnable keyless snapshots. This slice does not claim clean external installation: pre-read event registration and stopgates 4a/4b remain governed by the [portable-bundle proposal](../../proposed/architecture/2026-11-11-portable-conductor-bundle.md), which stays proposed. UI extraction, adapters, v6, locking and public release remain separate.
