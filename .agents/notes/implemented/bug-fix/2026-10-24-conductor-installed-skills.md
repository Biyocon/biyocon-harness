# Agent Note: Installed Conductor skills independent of task workspaces

Status: implemented

English | [中文](2026-10-24-conductor-installed-skills.zh.md)

## Problem

Conductor role paths resolved against the launch directory while protocol discovery depended on the task workspace. A session in another repository could not find `conductor-detective`; task filesystem restrictions could also hide installation files. The failure occurred after a run started, and the parent could continue without specialists.

## Decision

The [CLI build](../../../../apps/cli/tsdown.config.ts) generates installation resources from [the canonical roles](../../../conductor/roles/profiles.yml) and the four `conductor-*` directories under [the repository skills](../../../skills/README.md). Generated copies live inside the shipped preset and are excluded from source control. Keeping relative role resources with their Markdown preserves metadata without adding avatar behavior. The published CLI explicitly includes the generated directory.

The [preset](../../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml) resolves resource directories against its own `baseUrl`, using `!!js`, and creates a private skill registry for its Conductor runtime. [The preset installer](../../../../packages/conductor/conductor-presets/README.md) mounts host-read bundled filesystem providers and verifies all seven role names plus the specialist, Ralph, and closeout protocols before agent publication. Task cwd, workspace filesystem permissions, project skills, and user skill precedence do not select these instructions. Missing, malformed, or empty required skills reject mounting with a rebuild/reinstall diagnostic; preset disposal removes its providers.

The parent persona requires reporting Conductor errors and blockers and stopping without taking over the specialist task. This is model guidance, not a new write-tool restriction. [The runtime decision](../feature/2026-09-11-conductor-runtime-layer.md) still owns gates, child policies, and authorization; [the profile-assets decision](../feature/2026-10-24-conductor-role-profile-assets.md) still owns image associations. Neither decision is superseded.

## Alternatives considered

**Resolve source paths against task cwd.** An unrelated repository cannot supply installation-owned instructions, and its skill names must not override the installed protocol.

**Use absolute checkout paths in configuration.** They fail after moving or publishing the application.

**Maintain another authored role set inside the app.** Duplicate sources drift. Build-generated copies are justified because npm cannot package files outside the app directory; canonical Markdown remains the only authored source.

**Read installation files through task filesystem permissions.** These permissions govern task data, not trusted installed instructions. The existing bundled-provider host-read path keeps those responsibilities separate without broadening task access.

**Remove the parent's write tools.** That is a separate capability-policy decision, not required to repair instruction delivery.

## Consequences

The tool selects skills using the parent Agent as the scope key, not its Context object. The key's preset ancestry exposes the installed providers to dispatch; task cwd remains available only for providers whose discovery intentionally depends on the workspace.

Source-checkout Conductor use requires a build to prepare installation assets. Canonical edits require rebuilding; installed providers do not watch files. The private registry prevents project and user skill overrides for this runtime, while ordinary parent skill discovery remains separate.

Unit coverage pins required-content validation and provider disposal. A keyless [headless snapshot](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts) relocates the real shipped preset into an external temporary workspace, starts a fresh Detective, reads an actual marker file, rejects a project protocol override, and deliberately stops before writing. A missing-assets variant verifies rejection before the first model request. A package smoke checks the complete resource set and canonical bytes in the CLI packlist. This does not prove model compliance with a live provider or change the quality-command sandbox requirements.
