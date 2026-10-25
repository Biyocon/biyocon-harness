# Agent Note: Conductor mode routes tasks before workspace tools

Status: implemented

English | [中文](2026-10-25-conductor-mode-routing.zh.md)

## Problem

The Conductor preset described delegation as optional. A parent could read the workspace and answer a normal analysis task without starting specialists. Project instructions claiming higher specificity reinforced that path. Reporting tool failure and stopping was prompt guidance, so a parent could also continue alone after a blocked run.

## Decision

The [app preset](../../../../apps/cli/config/agent-presets/conductor/agent.cordis.yml) mandates `conductor` as the first tool call for every new task and enables the [tool's](../../../../packages/conductor/tool-conductor/README.md) `routeTasks` policy. The parent forwards the objective and constraints without inventing write authorization. Its system persona explicitly distinguishes specialist workspace guidance from mode routing.

The Conductor-local policy uses the existing agent, prompt-assembly, and tool execution hooks. Before dispatch, only `conductor` is offered and an executor guard rejects other tools. While dispatch runs and after any result, including an Arbiter GO, all parent tools remain hidden and denied; the parent can report the result but cannot execute a fallback or automatically redispatch. Ending a task without dispatch raises an explicit error. A new user turn or user steering message resets routing to allow only `conductor`, while plugin context does not. A successful decision is not authorization for parent execution. Specialist sessions are exempt from parent routing and retain the existing stage-specific executor restrictions. Registrations dispose with the mounted tool.

The tool description names the supervisor, seven fresh specialists, gate decisions, and defect-specific rework routes. This incorporates point 4 of [issue #27](https://github.com/Biyocon/biyocon-harness/issues/27); runtime paths, report validation, gate budgets, and expanded blocked-result rendering remain outside this decision. [Issue #26](https://github.com/Biyocon/biyocon-harness/issues/26) owns task routing. Source-launch generation in #25 and UI metadata in #28 are also unchanged.

### Analysis tasks and the stage model

Analysis has no separate successful terminal state. It follows Detective, Strategist, Devil's Advocate, Gate-C host approval, Headsman, Auditor, Integrator, and Arbiter. Empty `allowedPaths` produce a read-only effect profile and no write tools for Headsman or Integrator. A full analysis can reach the ordinary Arbiter decision using reports without file changes if each role satisfies its stage; roles that require unavailable implementation input or a denied Gate-C approval instead return a blocker. The parent reports that limitation rather than doing the analysis itself. This routing change does not promise analysis-only completion or skip implementation stages.

A future design can add an explicit read-only objective kind with a reviewed analysis deliverable and an analysis-specific transition to independent evaluation and Arbiter. That requires an owner-approved stage/report and persistence design, including completion criteria and snapshots; it is not implemented here. The current stages, host approval, rework budgets, Ralph rounds, and closeout authorization remain unchanged.

## Alternatives considered

**Only strengthen the persona.** Workspace guidance and model mistakes could still execute a solo read. Executor denial backs the prompt instruction; the keyless example verifies both advertised tools and the actual first call.

**Change the general workspace-instruction loader.** Other presets still need its normal precedence behavior. A Conductor-local policy keeps those presets unchanged and lets specialists follow project instructions within their existing capabilities.

**Permanently remove the parent's write tools.** That is F07, a separate composition decision. This routing policy leaves tool registrations and independent permission rules intact, but denies parent calls after dispatch until a new user message permits another Conductor dispatch. An Arbiter GO cannot authorize parent execution or closeout.

**Automatically manufacture a tool call from user text.** That would bypass model extraction of scope and resume fields or invent path authorization. The model supplies the call through the existing logged tool pipeline; a skipped dispatch fails explicitly rather than producing a false successful workflow.

## Consequences

Routing adds no session-event type, SDK field, or general loop change. Tool availability is reconstructed from the existing logged request headers. A noncompliant model can still emit text or request an unavailable tool; execution is denied and a text-only turn without dispatch fails, rather than silently completing the task. No prompt or keyless fixture establishes the quality of a live model's analysis.

The real [headless example](../../../../examples/headless-agent/tests/conductor-installed.snapshot.ts) uses an external workspace with contradictory AGENTS.md instructions and an objective without the word Conductor. Its adapter attempts a solo read when that tool is advertised. The recorded parent starts with `conductor`; the actual Detective reads a marker and returns a deliberate blocker. The assembled quality-command snapshots also enforce an empty parent tool list after GO. Focused tests exercise direct read/write denial after GO, failure fallback, new tasks, user steering versus plugin context, specialist independence, and policy disposal.

The [installed-skills decision](2026-10-24-conductor-installed-skills.md) remains active for resource ownership and mount validation. The [runtime decision](../feature/2026-09-11-conductor-runtime-layer.md) remains active for gates, capability policies, and owner authorization. Neither is fully superseded, so both are retained with links to this narrower policy; no notes are archived.
