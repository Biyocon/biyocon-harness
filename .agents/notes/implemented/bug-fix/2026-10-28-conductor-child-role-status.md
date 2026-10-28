# Agent Note: Conductor child roles and exact-attempt status

Status: implemented

English | [中文](2026-10-28-conductor-child-role-status.zh.md)

## Problem

[Issue #28](https://github.com/Biyocon/biyocon-harness/issues/28) describes specialist rows identified by session UUIDs and generic prompt-derived titles. A role alone cannot identify which rework attempt received a gate verdict: a later Strategist must not inherit an earlier Strategist's rejection.

## Decision

Conductor records model-hidden `conductor/child` snapshots in the parent Session. Each snapshot names the concrete child session, Conductor run, runtime-selected role, one-based role attempt, dispatch history offset, and lifecycle status. Workflow id matching attributes start/end events to the exact dispatch; neither labels, generated titles nor prompt text determine roles. Ralph uses the shared runner's trusted `observeRun` hook, rather than matching unrelated workflow events by time or name.

The saved gate checkpoint binds a verdict to the child whose dispatch history offset selects that evaluated gate. Intake-validation and skipped records never become child verdicts. Rework counts use the corresponding gate's independent budget. New children start without a verdict; every attempt remains separately addressable. Ralph workers receive lifecycle status without a Gate D verdict, which belongs to Headsman's subsequent report. A child that exits unsuccessfully or remains active at workflow disposal is marked failed without fabricating a verdict. Completed execution does not imply gate acceptance.

The shared base composition mounts the pure `conductorChildren` projection independently of live agent presets, so persisted catalogs survive agent disposal and application restart. Standalone Conductor assemblies may register the same projection through the tool. Inherited seed children are cleared at `session/end-seed`. The new Session event is required-on-read; older builds reject logs containing unknown required events. Conductor checkpoint format 3 and the SDK protocol remain unchanged.

The existing subagent list selects presentation by exact parent/child address. EN/DA rows display role, attempt number, lifecycle and optional gate outcome as text; the UUID remains available in secondary text and the accessible name. Ordinary subagents keep their existing labels, titles and navigation. Presentation adds no model input, authorization or runtime routing capability. Avatar rendering and team views are separate work.

## Alternatives considered

Prompt/title parsing cannot establish runtime identity. A role-keyed latest verdict loses earlier attempts and leaks rework results into later children. Live-only workflow metadata cannot reproduce the catalog after restart. Exact child snapshots avoid these ambiguities without changing the generic subagent header or workflow wire protocol.

## Consequences

Persisting presentation adds small parent events rather than reconstructing roles from mutable titles or relying on live workflow state. Full snapshots make replay and exact-child replacement straightforward. A parent projection avoids changing generic child headers or the workflow protocol, at the cost of requiring the owning projection in host assemblies that display historical catalogs.

## Verification

Focused runtime tests exercise separate Strategist attempts, workflow identity filtering, failure without an invented gate, projection replay and seed clearing. EN/DA client tests cover rework/running rows and preserve ordinary subagent behavior. The installed-preset keyless runnable example exercises role metadata for actual workflow children, including a criteria-repair run with distinct Strategist attempts. A real short-answer analysis on the branch server supplies the GUI demonstration; media lives on a separate assets branch.

The Conductor-owned client plugin renders through the generic catalog content chain. The generic catalog has no Conductor dependency or role interpretation. Row accessibility references the elected text and exact metrics; absent contributions keep the ordinary fallback.
