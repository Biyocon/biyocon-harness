# Agent Note: Pin koffi for packed installs

Status: implemented

English | [中文](2026-10-11-pin-koffi-for-packed-installs.zh.md)

## Problem

Packed tarball consumers resolve dependencies from published package manifests without the workspace lockfile. A `koffi` declaration of `^3.1.0` can therefore select a newer release than the workspace uses. `koffi` `3.3.2` and `3.3.3` fail to compile from source under Node `24.21.0` on Linux, so the release rehearsal can fail even when the source commit and its workspace lockfile are unchanged.

The failure is reproducible in a `node:24.21.0-bookworm` container: installing `koffi@^3.1.0` resolves `3.3.3` and fails in `src/koffi/src/uv.cc`, while installing `koffi@3.1.1` succeeds under the same conditions. A release gate must test the dependencies selected by the published manifests, not depend on registry timing.

## Decision

The four published packages that consume `koffi` declare exact version `3.1.1`. Their lockfile importers carry the same exact specifier. Workspace and packed-consumer resolution remain aligned until a later dependency update explicitly validates and selects another version.

The packed-install gate remains unchanged and continues to install the published tarballs with npm. It must retain native build execution and may not omit the failing dependency to make the gate green.

## Alternatives considered

**Keep `^3.1.0` and rely on the workspace lockfile.** Rejected because external tarball consumers do not receive the workspace lockfile, so the tested source dependency and the installed publication dependency can differ.

**Add only a root pnpm override.** Rejected because npm installation of published tarballs does not read the repository's pnpm override.

**Disable native build scripts or remove `koffi` from the packed-install rehearsal.** Rejected because this would hide an installation failure that downstream consumers can encounter.

**Advance to the newest matching `koffi` release.** Rejected until that release compiles on the supported Node 24 Linux release path and the package-owned native behavior tests pass.

## Consequences

Packed consumers deterministically select the same `koffi` version as the workspace. The exact dependency does not receive compatible fixes automatically, so Dependabot or a deliberate dependency change must validate a newer release before updating all four manifests together.

The pin addresses deterministic dependency selection, not compatibility with future Node releases. The packed-install matrix remains responsible for detecting when `3.1.1` stops building or loading on a supported runtime.

## Verification

- In a `node:24.21.0-bookworm` container with CMake and Ninja, `npm install --omit=optional 'koffi@^3.1.0'` resolved `3.3.3` and failed in `src/koffi/src/uv.cc`; exact `3.3.2` and `3.3.3` reproduced the failure, while exact `3.1.1` installed successfully under the same conditions.
- The four published `koffi` consumers and their lockfile importers declare exact version `3.1.1`.
- Focused Vitest runs for the four consumer packages completed with 26 test files passing, 589 tests passing, and 2 platform-specific tests skipped.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run doc-sync` passed, and `git diff --check` reported no errors.
- A local repository-wide rehearsal at commit `ad595f4` reproduced the release job's pack and install sequence in `node:24.21.0-bookworm`: it verified 224 DSH release members, built the repository, packed 224 DSH tarballs, 9 vendor tarballs, and the Landlock entry, then installed 234 tarballs into an external consumer. The installed `@deepseek-ai/dsh` executable reported `0.1.0-rc.7`, and the sequence exited successfully. GitHub Actions on Ubuntu remains the authoritative release gate.
