# @deepseek-ai/dsh-conductor-host-rc7

English | [中文](README.zh.md)

Optional Conductor host bundle for Biyocon Harness rc.7. Enable it explicitly between `dsh-base` and the surface bundle in the profile's `dsh.profile.bundles` list. It registers both child and unavailable-run projections before session replay and contributes its package-contained `presets` directory through `dsh.bundle.presetRoot`.

## Resources and installation

The committed preset tree is a generated projection, available before install or build. `pnpm run verify-conductor-resources` checks its exact allowlist and canonical SHA-256 hashes without regenerating it; static CI and doc-sync run this check. The package build prepares 27 literal allowlisted assets and two preset files through [conductor-presets](../conductor-presets/README.md). No canonical directory is recursively copied. The generated manifest records each resource's SHA-256; `pnpm run verify-conductor-pack` verifies the actual npm tarball against canonical bytes and rejects missing, additional or modified resources. The CLI contains no Conductor preset copy or preparation import.

Biyocon's source command prepares the same resources before boot and refuses the exact legacy CLI asset remainder with a backup command; the [source-checkout upgrade procedure](../../../.agents/notes/implemented/architecture/2026-11-12-conductor-rc7-host-bundle.md) includes profile-manifest backup before migration. Existing profiles containing `dsh-base` gain this bundle through the installation's one-time extraction migration; a later explicit removal is respected. The existing strict run-format checks and unavailable-run behavior remain unchanged. No session files are rewritten.

## Model Experience

Indirectly, through the packaged Conductor preset; its tools and persona own the model-visible context.

#### KV Cache effect

The resource relocation preserves the same stable request prefixes; editing canonical instructions changes them as documented by conductor-presets.

## Known Limitations and Deferred Work

- This bundle supports rc.7 only. Pre-read event registration, clean packed-install stopgate 4a, pinned-upstream stopgate 4b and optional UI extraction follow separately. The package is not publicly released; installing it into another host does not prove compatibility.
