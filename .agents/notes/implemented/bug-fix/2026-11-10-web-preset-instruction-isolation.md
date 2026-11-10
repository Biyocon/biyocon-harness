# Agent Note: Browser preset instruction isolation

Status: implemented

English | [中文](2026-11-10-web-preset-instruction-isolation.zh.md)

## Problem

[Issue #80](https://github.com/Biyocon/biyocon-harness/issues/80) records extra ancestor instructions in native Windows steering goldens. Disabling the deployment's instruction row does not disable the separate loader mounted by the shipped standard preset. Without a nearer project marker, that loader can discover an ancestor project and inject its instructions into replay requests.

## Decision

The [browser scaffold](../../../../apps/web/tests/scaffold.ts) creates a `.git` project-root marker inside its owned temporary workspace before composition starts. The [English/Danish picker helpers](../../../../apps/web/tests/support.ts) also mark each staged workspace: project skills must resolve at the selected workspace rather than the outer scaffold directory. The preset's existing instruction loader remains active and finds the local marker before any ancestor project. Its global home is already confined to the scaffold's synthetic `DSH_HOME`. Synthetic project instructions within the workspace remain available, including for child directories. The marker is not an initialized Git repository and gives no additional tool authority.

The [browser-lane note](../testing/2026-07-24-web-gui-browser-e2e-lane.md) retains its composition and replay decisions; only its instruction-isolation description changes. Product instruction discovery, source normalization and committed browser goldens are unchanged.

## Alternatives considered

**Disable the host instruction row only.** The preset mounts independently of that overlay, leaving its model-visible context uncontrolled.

**Copy and rewrite shipped presets for replay.** This adds a second composition to maintain and can hide product integration defects. A root marker uses the shipped loader's existing project-discovery behavior.

## Consequences

The assembled regression runs an actual replayed model turn below a synthetic ancestor containing `.git` and `AGENTS.md`. It rejects the ancestor sentinel and requires the workspace sentinel in logged context, proving isolation without disabling the real preset loader. Test temp-root environment variables are restored after the scaffold closes. No private instruction contents or owner sessions enter fixtures or committed logs. A scenario requiring Git operations must initialize a real repository inside the owned workspace.
