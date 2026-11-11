# Agent Note: Portable Conductor bundle and client adapters

Status: proposed

English | [中文](2026-11-11-portable-conductor-bundle.zh.md)

## Problem

The Conductor run engine is divided into reusable packages, but the installed product is not an independent plugin. The CLI owns the `conductor` preset and copies its role and protocol files from the repository before launch. An `npm pack --dry-run --json --ignore-scripts` check found eight files and no role or protocol assets in `dsh-conductor-presets`, while the CLI tarball contains 29 Conductor preset files. The base and Web bundles mount Conductor unconditionally, while generic question UI and host APIs contain Conductor-specific owner interactions. Installing the current `dsh-conductor-presets` package into another DeepSeek Harness fork therefore does not install the preset, its instructions, or all required host behavior. The owner needs one finished Conductor runtime that Biyocon Harness and a separate Harness fork can install, followed by adapters for other desktop and CLI clients and, later, a separately approved public release.

## Proposal

Make one optional Conductor distribution whose canonical runtime remains in `packages/conductor/*`. A bundle package declares `dsh.bundle` and owns the host presentation row, the Conductor tool, its preset composition and metadata, and the complete role, protocol, template, and image assets. A separate optional Web UI bundle owns Conductor-specific subagent and owner-question presentation. Biyocon's profiles install these same packages; another Harness fork installs their packed artifacts without copying Biyocon source. The generic base, Web bundle, source launcher, preset picker, session reader, and question UI gain only small reusable plugin extension points where required. The core never imports Conductor. The [core dependency inventory](2026-11-05-conductor-core-dependencies.md) records each host change with its file, purpose, and PR.

### Package and composition ownership

| Current binding | Proposed owner and behavior |
|---|---|
| [`apps/cli/config/agent-presets/conductor/`](../../../../apps/cli/config/agent-presets/conductor/preset.yml) and [`generate-conductor-skills.ts`](../../../../apps/cli/scripts/generate-conductor-skills.ts) | The Conductor distribution packs authored assets and a complete preset. The preset resolves resources relative to its installed package, never the task workspace or a source checkout. The generic preset roster discovers it through a declared package/root input; missing assets reject mount before agent publication. |
| [`dsh-base`](../../../../packages/bundle/base/cordis.patch.yml) and [`dsh-web-app`](../../../../packages/bundle/web-app/cordis.patch.yml) | Optional Conductor host and UI bundles own their rows and dependencies. Removing the bundles leaves a working generic Harness. Enabling them installs projections before a Conductor session is read. |
| [`ui-user-questions`](../../../../packages/client/ui-user-questions/README.md) and [`apiproxy`](../../../../packages/host/apiproxy/README.md) | Move Conductor cards and receipts into the optional UI plugin. Keep a generic, typed owner-intent registration and server validation path; the external client cannot forge an approval by supplying model text or a guessed question id. |
| [`known-event-types.ts`](../../../../packages/core/session/src/known-event-types.ts) | The session reader must recognize installed required Conductor events before replay. Replace the repository-path-only generator assumption with a validated installed-package event declaration or equivalent assembled-catalog input. Unknown required events still fail closed; an unavailable old Conductor run must not hide unrelated chat history. |

The first extraction slice is a packed host bundle and preset, with no client adapter or record change. [`composeProfile`](../../../../apps/cli/src/profile-boot.ts) currently replaces `agent-presets.roots` with the CLI's shipped directory after bundle composition, so a bundle patch cannot register its own preset. Add an optional `dsh.bundle.presetRoot` relative to each installed bundle; the host resolves it inside that package and gives it system trust. Move Conductor out of the CLI's shipped root and base bundle into the new bundle in the same change, then list it in Biyocon's profiles. Keep explicit system-before-user precedence and reject duplicate ids between system roots rather than silently shadowing them. Prove the packed artifact with install, composition, missing-asset, duplicate-id, and absent-bundle tests before moving UI or owner APIs.

The bundle's public package name must be in a namespace controlled by the publisher. The current `@deepseek-ai/*` names and upstream repository fields cannot be treated as permission to publish under that namespace. Choose and validate the release identity before a public tarball; the local prototype can use an unpublished package spec. Preserve peer identity for Cordis and shared Harness services so the installed bundle does not load a second core. The upstream [plugin installation guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md) describes `dsh plugin --profile <name> add <package>` and bundle composition; the test must use the selected target version's actual command and packed package. Pin the supported host version and require an explicit compatibility check for each newer upstream release; Biyocon Harness itself remains on rc.7.

### Host security and lifecycle

One Harness host owns each run and its session log. Adapters connect to that host; they must not launch independent writers for the same `DSH_HOME`. Before multi-client operation, the host-level home/session-store ownership design in [#87](https://github.com/Biyocon/biyocon-harness/pull/87) or an equivalent verified mechanism must reject competing writers. A client disconnect does not finish, cancel, or duplicate a run. Start, status, result, resume, and owner-response operations use typed run/session identities and enforce the host's existing authorization. Owner responses bind to the current question, revision, proposal hash, run, and owner session; Gate C remains a separate explicit approval. Read-only analysis grants no write or release authority. No adapter exposes arbitrary files, credentials, or private role definitions.

The [installed-skill decision](../../implemented/bug-fix/2026-10-24-conductor-installed-skills.md) still governs trusted host reads, isolated skill precedence, and failure before publication. The [runtime decision](../../implemented/feature/2026-09-11-conductor-runtime-layer.md) still governs gates and tool enforcement. This proposal changes packaging and host composition, not those decisions. The shared v6 design for #75 phase 2, #30 phase 2, and #58 phase B needs its own review before any record or runtime-format change; packaging may be verified against the current format without claiming the final runtime is complete.

### Client adapters

The DSH bundle is the product engine; a client adapter is a separate distribution part. Prefer one host API and a narrow MCP facade over copies of Conductor logic. The facade offers start, status, accepted result, and resume, plus an owner-response operation only when the host can authenticate the owner and present the exact pending proposal. A client that cannot satisfy that condition may read a parked run but cannot approve it. Every client must be tested through its normal UI against the same host and persisted run.

| Client | Connection to verify before implementation | Distinct acceptance |
|---|---|---|
| ChatGPT Desktop | Official [plugin connection](https://developers.openai.com/plugins/deploy/connect-chatgpt) and [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) describe private MCP access; [desktop-only plugins](https://developers.openai.com/plugins/deploy/desktop-only) describe local execution. Check the owner's actual account, workspace permissions, and supported route. | A real ChatGPT desktop conversation starts and reads a run; browser/API or Codex CLI success is insufficient. Tunnel setup and any key use require a separate owner decision. |
| PI-Desktop | The owner's Super-Desktop fork points to [vastsa/PI-Desktop](https://github.com/vastsa/PI-Desktop); its [plugin guide](https://github.com/vastsa/PI-Desktop/blob/main/docs/plugin-development.md) declares stdio and HTTP MCP servers, with local commands limited to a PATH name or plugin-relative executable. Verify the exact installed upstream release and its supported manifest; do not infer behavior from the fork. | Its own normal UI starts and reads the host run. |
| Super-Desktop | Recheck the owner's fork's stdio/HTTP MCP client on the pinned revision before wiring. | Its normal chat invokes the shared facade rather than a copied runtime. |
| Multica | Recheck the chosen agent provider and where its daemon executes MCP commands. | Its normal UI reaches the same host, returns the actual run id, and reads the result after restart. |

## Alternatives considered

**A separate Conductor service as the primary product.** It could serve MCP clients directly, but it would not make Conductor installable as a DSH plugin in another fork. It would also add a second host lifecycle and session-store owner. Keep a service or MCP facade as an optional adapter in front of the packaged DSH runtime.

**Copy the CLI preset and source assets into every fork.** It permits a quick local trial but duplicates authored roles, package wiring, and updates. It cannot establish that the packed plugin is self-contained.

**Move all Conductor-specific host behavior into generic core.** This would make the host depend on Conductor and burden installations without it. Generic registration points with optional Conductor providers preserve the dependency direction.

## Acceptance criteria

A clean second Harness installation uses only the actual packed Conductor artifacts and a documented profile command; no Biyocon checkout, generated source-tree copies, private data, or manual preset-file transfer are present. The selected host version passes package-content, dependency-identity, install, reload, replay, and absent-plugin tests. A keyless synthetic example exercises analysis and gates; separate authorized model tests and owner-interaction tests prove real dispatch, rejection of stale or forged responses, resume, and status after host restart. Biyocon uses the identical distribution and retains its current product behavior. The four target clients each pass their own normal-UI acceptance; a pilot in one does not stand in for another. The public release additionally needs publisher-owned naming, license/provenance and secret audits, installation docs, a host compatibility matrix, and a separate owner release decision.

## Risks

The newer upstream host may lack generic child, output-limit, owner-question, or event-catalog capabilities on which Conductor relies; package installation alone is not compatibility evidence. Moving owner UI and required-event recognition can change replay and authorization, so tests must include invalid and unsupported records as well as successful runs. A tunnel or MCP client changes the access path, not the host's approval authority. The installed PI-Desktop release and each client account's permissions remain to be verified before adapter implementation. Existing active notes remain authoritative for their shipped mechanisms; this proposal partially overlaps their packaging descriptions but supersedes none until code ships.
