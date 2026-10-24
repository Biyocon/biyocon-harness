# Agent Note: Static Conductor role profile assets

Status: implemented

English | [中文](2026-10-24-conductor-role-profile-assets.zh.md)

## Problem

Conductor's role skills need portable associations with the supplied profile images without introducing unfinished avatar APIs or changing specialist execution.

## Decision

The [role profile manifest](../../../conductor/roles/profiles.yml) maps The Conductor and seven specialists to eight local WebP files. Each specialist's existing skill frontmatter repeats its display name and relative avatar filename. The filesystem skill provider preserves these fields as metadata and supplies the role directory as `resourceBase`; the role instructions and invocation flags remain unchanged.

The images derive from the eight square PNGs in backup commit `79d3518f04b831e832fccdc9fc3c450ddec2cf0e`. FFmpeg encodes the complete image at 512×512 using Lanczos scaling, WebP quality 90, compression level 6, and no source metadata. Their combined size is 460,586 bytes rather than 23,872,437 bytes. The backup retains the originals and unused non-square Arbiter alternative.

These files are static repository assets. No runtime loads the manifest, resolves avatars at dispatch, persists presentation fields, or renders these images. The [Conductor runtime decision](2026-09-11-conductor-runtime-layer.md) remains authoritative for specialist execution.

## Alternatives considered

**Carry the unfinished runtime changes.** Descriptor, attachment, workflow, and client API changes require a complete consumer and separate verification; they are unnecessary for a static role association.

**Commit the full-size PNGs and alternate image.** They enlarge the repository without improving the active profile mapping. The backup preserves the supplied source set.

**Use absolute image paths.** They bind metadata to one machine and checkout. Relative filenames remain resolvable from the skill's existing resource directory.

## Consequences

The CLI's [installed-skills projection](../bug-fix/2026-10-24-conductor-installed-skills.md) preserves these relative resources when packaging the role directory; it adds no runtime avatar rendering.

The profile images are discoverable and small, but downscaling and lossy WebP encoding trade full-resolution detail for repository size. The manifest and role metadata duplicate a deliberate association, so tests pin their agreement, image format, dimensions, and size limits.

A real filesystem-provider test checks parsed metadata, relative resources, and unchanged role bodies. No assembled application snapshot changes because model-visible instructions, tool output, and client rendering are unchanged. Visible avatars require a separate implementation decision.
