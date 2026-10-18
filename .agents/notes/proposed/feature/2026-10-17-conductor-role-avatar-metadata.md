# Agent Note: Conductor role avatar metadata

Status: proposed

English | [中文](2026-10-17-conductor-role-avatar-metadata.zh.md)

## Problem

Conductor's role files provide persona instructions and durable names, but they do not associate those roles with the supplied profile images. A host cannot discover the intended image without relying on filenames outside the role directory. ChatGPT Desktop exposes no avatar field, and Harness needs an explicit durable presentation path from role metadata through subagent discovery to a rendering client.

## Proposal

Store the supplied images beside the role files under `.agents/conductor/roles`, give each active specialist skill a relative `metadata.avatar` and `metadata.displayName`, and provide `profiles.yml` for the parent Conductor profile plus the complete active-role mapping. Resolve relative avatar paths against the filesystem skill's existing `resourceBase`, validate the image, register it as a durable attachment, and pass a host-owned, model-hidden `{ displayName, avatar }` presentation when Conductor starts a specialist.

Persist the presentation in subagent descriptor version 3, project it through the child catalog, and authorize the descriptor's image reference through the existing session attachment read. Workflow and Ralph child composition carry the same trusted presentation without exposing it to model-written scripts. Client renderers may then request the image by session and attachment id; they retain the existing generated icon when presentation or image data is absent.

Keep the square `07-the-arbiter.png` as the active Arbiter image. Retain the supplied non-square Arbiter alternative as an unassigned asset instead of presenting it as the active profile.

Treat this as a portable Harness presentation contract. It does not override ChatGPT Desktop's client-owned subagent icons. Until the Conductor resolver and Harness renderer consume the new fields, the repository assets remain discoverable metadata rather than visible avatars.

## Alternatives considered

**Embed absolute Windows paths.** Absolute paths bind the profile to one checkout and cannot cross a process, machine, browser, package, or worktree boundary.

**Embed image bytes in role prompts.** Base64 data would add megabytes to model-facing content, pollute the session log, and still would not create a client avatar field.

**Put image bytes in lifecycle events.** Repeating binary payloads in event and catalog frames would enlarge logs and wire traffic. A durable attachment reference keeps the descriptor small and reuses session-scoped read authorization.

**Patch ChatGPT Desktop.** Its subagent protocol and client own those icons. Repository files cannot add an unsupported field, and modifying the installed signed application is outside this feature.

## Acceptance criteria

- The parent Conductor and all seven active specialist profiles map to existing PNG files under `.agents/conductor/roles`.
- Each specialist role carries a display name and relative avatar path in parsed skill metadata.
- Tests reject a missing, renamed, non-PNG, or non-square active avatar.
- Conductor resolves each active role image to a durable attachment before specialist publication and supplies the matching presentation to every fresh spawn, including Ralph rounds.
- Descriptor persistence, projection, API schemas, workflow transport, and session-authorized image reads preserve valid presentation data and reject malformed durable data.
- Harness subagent UI surfaces render the supplied avatar with the current generated icon as fallback.
- Documentation distinguishes the repository association from actual client rendering support.
- No image path depends on the original `temp` directory or an absolute checkout path.

## Risks

The image files add substantial repository size. A descriptor can authorize an attachment read only after the asset has been validated and registered for that child session. Client applications may ignore the metadata until they implement the matching renderer. The retained alternate Arbiter asset may be mistaken for an active avatar if a consumer ignores the manifest's unassigned classification.
