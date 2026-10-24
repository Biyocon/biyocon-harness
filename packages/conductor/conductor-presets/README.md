# @deepseek-ai/dsh-conductor-presets

English | [中文](README.zh.md)

Installs and validates Conductor's role and protocol skills for the [shipped app preset](../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml). The package also exports the canonical role-directory name and stage-to-skill metadata used by [the Conductor tool](../tool-conductor/README.md).

## Installation and configuration

The CLI build copies [the canonical role directory](../../../.agents/conductor/roles/profiles.yml) and the `conductor-*` bundles from [the repository skills](../../../.agents/skills/README.md) into the app preset's generated `skills/` directory. These copies are distribution artifacts, not additional authored sources. Run `pnpm run build` before mounting the source checkout's Conductor preset; the published CLI includes the generated files.

| Config | Required value |
|---|---|
| `rolesDirectory` | Absolute installation directory containing the seven role Markdown files and their resources. |
| `protocolDirectory` | Absolute installation root containing the `conductor-*` protocol skill directories. |

The app resolves both paths relative to the preset's `baseUrl` with `!!js`. Its private `skills` registry is shared with the Conductor tool, not with the task's project or user skill catalogs. Providers read these bundled installation files on the host rather than through the task filesystem. Loading rejects relative directories, missing or malformed required skills, and empty instruction bodies before the preset can publish an agent. Provider registrations unwind with the preset.

The parent persona instructs the agent to report Conductor errors or blockers and stop instead of implementing the task independently. Its filesystem tools remain available; this instruction is not a replacement for executor permissions. [The installation decision](../../../.agents/notes/implemented/bug-fix/2026-10-24-conductor-installed-skills.md) explains distribution and ownership.

## Model Experience

Indirectly, through [the Conductor tool](../tool-conductor/README.md), which injects the selected role and protocol bodies into fresh specialist requests.

#### KV Cache effect

Changing bundled instructions changes the corresponding specialist request prefix; installing or validating them adds no parent conversation messages.

## Known Limitations and Deferred Work

- The CLI build must regenerate installation assets after canonical role or protocol edits; the running preset does not watch them.
- Mount validation establishes availability, not that a model will obey the instructions; stage executors own capability enforcement.
