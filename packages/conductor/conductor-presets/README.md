# @deepseek-ai/dsh-conductor-presets

English | [中文](README.zh.md)

Installs and validates Conductor's role and protocol skills for the [shipped app preset](../../../packages/conductor/conductor-presets/presets/conductor/agent.cordis.yml). The package also exports the canonical role-directory name and stage-to-skill metadata used by [the Conductor tool](../tool-conductor/README.md).

## Installation and configuration

The [rc.7 host bundle](../conductor-host-rc7/README.md) builds the 27 allowed role, protocol, template and image assets from their canonical sources and carries this package's preset files. Its generated resources are committed distribution projections, hash-checked against the canonical sources before build; a clean checkout needs no manual prepack. Package-owned preparation runs before every `pnpm dsh` source launch; installed hosts read the tarball's resources without a source checkout. Unchanged bytes cause no writes; changed files are staged and atomically replaced per file, including ordinary open readers on Windows. Preparation failures stop launch, and required-content validation rejects preset mounting. Existing definitions are not hot-reloaded. [The publication decision](../../../.agents/notes/implemented/bug-fix/2026-11-01-conductor-source-launch-assets.md) owns concurrency and failure semantics.

| Config | Required value |
|---|---|
| `rolesDirectory` | Absolute installation directory containing the seven role Markdown files and their resources. |
| `protocolDirectory` | Absolute installation root containing the `conductor-*` protocol skill directories. |
| `sharedProtocolFile` | Absolute installation file containing the shared role protocol referenced by the role Markdown. |

The app resolves these paths relative to the preset's `baseUrl` with `!!js`. Its private `skills` registry is shared with the Conductor tool, not with the task's project or user skill catalogs. Installation files are read on the host rather than through the task filesystem. Loading rejects relative paths, missing or malformed required skills, and unreadable or empty instructions before the preset can publish an agent. Validated roles become prepared definitions with the exact shared protocol prepended as reference; specialists use their dispatch and structured schema instead of reading repository links from the task workspace. Registrations unwind with the preset.

The Devil's Advocate role and `conductor-specialist` skill each require `metadata.analysisCritic` with `dispatchMode: critic` and nonempty `instructions`; an invalid or missing critic mode rejects preset mounting. The critic instructions are separate from the Markdown producer bodies and are not injected into current analysis dispatches. A typed critic dispatch selects them when that route is enabled. [The instruction decision](../../../.agents/notes/implemented/feature/2026-11-03-conductor-analysis-critic-instructions.md) records this separation.

The app enables the tool's `routeTasks` policy: each new parent task starts with `conductor`, including analysis that does not name the mode. Before dispatch, other tools are hidden and executor-denied. After any result, including an Arbiter GO, all parent tools remain hidden and denied; only a final report is permitted, not solo investigation, implementation, or automatic redispatch. Workspace instructions remain available to specialists but cannot bypass this executor policy. Pending owner questions preserve new user tasks in the visible queue without opening ordinary tools; only a host-reserved same-run continuation may proceed. Outside that pending interaction, the next user task allows only another Conductor dispatch. [The routing decision](../../../.agents/notes/implemented/bug-fix/2026-10-25-conductor-mode-routing.md) explains this policy; [the installation decision](../../../.agents/notes/implemented/bug-fix/2026-10-24-conductor-installed-skills.md) owns instruction delivery.

## Model Experience

Indirectly, through [the Conductor tool](../tool-conductor/README.md), which injects the selected role and protocol bodies into fresh specialist requests.

#### KV Cache effect

The shared protocol contributes a stable prefix to every role. Editing it changes all specialist prefixes; editing one role changes that role's prefix. Installing or validating instructions adds no parent conversation messages.

## Known Limitations and Deferred Work

- Completed canonical instruction edits take effect on the next source launch; the running preset does not watch or reload installation assets.
- File/directory type changes at an installed path are rejected before publication; use a fresh source checkout for such resource-layout changes. Active paths are never removed early to accommodate a type change.
- Mount validation establishes availability, not that a model will obey the instructions; stage executors own capability enforcement.
- The shipped preset enables `ownerQuestions` on the Conductor tool. The web app supplies its typed owner-question card; deployments without a user-question provider leave recoverable questions parked without granting authority.
