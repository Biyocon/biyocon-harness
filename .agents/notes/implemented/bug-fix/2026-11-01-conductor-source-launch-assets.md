# Agent Note: Prepare Conductor instructions at source launch

Status: implemented

English | [中文](2026-11-01-conductor-source-launch-assets.zh.md)

## Problem

Conductor's installation resources were generated only by the CLI build. Restarting from source after editing canonical roles or protocols could silently load older instructions. Replacing the active skills directory by deleting it first also exposed concurrent readers to missing or incomplete resources.

## Decision

The [source-only preload](../../../../packages/conductor/conductor-presets/scripts/prepare-source.ts) awaits the [shared generator](../../../../packages/conductor/conductor-presets/scripts/prepare-assets.ts) before Node starts the ordinary CLI entry. Paths are installation-relative, not task-relative. The rc.7 host-bundle build uses the same generator; the published bin never imports source preparation. A generation failure prints a Conductor-specific diagnostic, lets stderr drain, and exits before CLI dispatch, including informational commands. The [installed-skill validation and routing rules](2026-10-24-conductor-installed-skills.md) remain authoritative.

The generator reads canonical bytes and compares them with installed files before creating staging output. Identical inputs perform no filesystem mutations. Changed files are fully written and closed in a unique sibling staging directory. The first installation publishes the complete directory with one rename, preserving the parent directory's access mode on POSIX. Updates replace individual files without removing the active directory: POSIX uses rename, and Windows uses the existing [ReplaceFileW helper](../../../../packages/fs/fs-local/src/win32.ts) for existing targets, including files held open by ordinary Node readers. Obsolete files are unlinked only after all replacements succeed; resolved filesystem paths protect case-only aliases of retained files. Each invocation cleans only its own staging directory.

Concurrent launches against unchanged canonical sources can publish the same bytes independently; a publisher rechecks each target before replacement. Directory-publication conflicts fall through to per-file publication, and an already-removed obsolete file is harmless. A creation race is accepted only when the winning file contains the exact expected bytes. No failed file replacement is retried. Exclusive Windows handles that prohibit replacement stop generation instead of triggering deletion or fallback to stale instructions.

## Alternatives considered

**Build on every launch.** A full build also refreshes unrelated browser and package artifacts. Instruction preparation needs only the canonical resource generator.

**Delete the active directory and copy over it.** Readers can observe missing paths or partially written files, including another source launch or an existing app.

**Use Node rename for every Windows replacement.** Native Windows tests show that replacing an existing file with an open Node read handle fails with EPERM. The existing native helper preserves that reader's old contents while new opens see the replacement.

**Rewrite identical files or retry sharing failures.** Rewrites add unnecessary I/O and change timestamps. Retries conceal sharing and permission failures without establishing correct publication.

## Consequences

Publication is atomic per file, not a transaction across all role and protocol files. File/directory type conflicts fail before any publication and name the generated, git-ignored directory that can safely be removed and rebuilt on the next launch; converting an occupied path would require removing it before its replacement exists, violating the publication rule. Existing prepared definitions are not hot-reloaded. Canonical edits must finish before launching; concurrent editing of the canonical tree is not a supported snapshot operation. Browser artifacts still require their separate build, as described by the [build-scheduling decision](../simplification/2026-08-12-separate-source-launch-from-build.md).

The Windows launcher recognizes the legacy source bin, the source preparation entry, and the published bin by their web command lines; the standalone PowerShell check tests all three without starting a server. The source regression tests use separate homes and an external workspace, exercise initial generation, changed instructions on the next launch, simultaneous processes, invalid roles, and fail-closed generation. Publication tests force overlapping writers and pause replacement while a reader holds the old file open; they also assert zero mutations on unchanged inputs and preservation on staging/publication failure. The [real headless snapshot](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts) starts with absent assets in an isolated checkout, prepares them through the source entry, and retains missing-role rejection before a model request. The host-bundle package smoke verifies canonical bytes in the shipped resources. Native Windows CI owns the open-handle behavior on the Windows kernel.
