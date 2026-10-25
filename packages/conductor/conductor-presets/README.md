# @deepseek-ai/dsh-conductor-presets

English | [中文](README.zh.md)

Installs and validates Conductor's role and protocol skills for the [shipped app preset](../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml). The package also exports the canonical role-directory name and stage-to-skill metadata used by [the Conductor tool](../tool-conductor/README.md).

## Installation and configuration

The CLI build copies [the canonical role directory](../../../.agents/conductor/roles/profiles.yml), its [shared protocol](../../../.agents/conductor/README.md) and linked templates, and the `conductor-*` bundles from [the repository skills](../../../.agents/skills/README.md) into the app preset's generated `skills/` directory. These copies are distribution artifacts, not additional authored sources. Run `pnpm run build` before mounting the source checkout's Conductor preset; the published CLI includes the generated files.

| Config | Required value |
|---|---|
| `rolesDirectory` | Absolute installation directory containing the seven role Markdown files and their resources. |
| `protocolDirectory` | Absolute installation root containing the `conductor-*` protocol skill directories. |
| `sharedProtocolFile` | Absolute installation file containing the shared role protocol referenced by the role Markdown. |

The app resolves these paths relative to the preset's `baseUrl` with `!!js`. Its private `skills` registry is shared with the Conductor tool, not with the task's project or user skill catalogs. Installation files are read on the host rather than through the task filesystem. Loading rejects relative paths, missing or malformed required skills, and unreadable or empty instructions before the preset can publish an agent. Validated roles become prepared definitions with the exact shared protocol prepended as reference; specialists use their dispatch and structured schema instead of reading repository links from the task workspace. Registrations unwind with the preset.

The app enables the tool's `routeTasks` policy: each new parent task starts with `conductor`, including analysis that does not name the mode. Before dispatch, other tools are hidden and executor-denied. A blocked or failed dispatch permits only a final report, not solo investigation, implementation, or automatic redispatch. Workspace instructions remain available to specialists but cannot bypass this executor policy. After an Arbiter decision, existing parent capabilities are unchanged; the next user task requires another dispatch. [The routing decision](../../../.agents/notes/implemented/bug-fix/2026-10-25-conductor-mode-routing.md) explains this policy; [the installation decision](../../../.agents/notes/implemented/bug-fix/2026-10-24-conductor-installed-skills.md) owns instruction delivery.

## Model Experience

Indirectly, through [the Conductor tool](../tool-conductor/README.md), which injects the selected role and protocol bodies into fresh specialist requests.

#### KV Cache effect

The shared protocol contributes a stable prefix to every role. Editing it changes all specialist prefixes; editing one role changes that role's prefix. Installing or validating instructions adds no parent conversation messages.

## Known Limitations and Deferred Work

- Canonical instruction edits require rebuilding and restarting the app; the running preset does not watch or reload installation assets.
- Mount validation establishes availability, not that a model will obey the instructions; stage executors own capability enforcement.
- Analysis uses the same A–G workflow and host approval at Gate C; the preset has no analysis-only completion stage.
