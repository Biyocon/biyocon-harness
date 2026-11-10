# Agent Note: Biyocon launcher home and desktop warning

Status: implemented

English | [中文](2026-11-10-biyocon-launcher-home-and-desktop-warning.zh.md)

## Problem

The official desktop app and Biyocon can write incompatible credentials or projection caches in the same home. An inherited `DSH_HOME` can also send the Biyocon shortcut to an unintended store. The launcher mutex coordinates Biyocon launchers, not the official app.

## Decision

The [launcher](../../../../start-biyocon.ps1) sets `DSH_HOME` to `$HOME\.dsh` before launching the server, replacing any inherited value. The child command inherits that environment. If a process named `DeepSeek Harness` is present, the launcher warns about shared credentials and session data and asks the owner to close the official app. The warning continues normal launcher processing and never stops a process. Existing listener and Biyocon-server checks still decide whether to reuse, refuse or launch a server.

## Alternatives considered

**Stop the official process automatically.** Rejected because the owner controls that application and its pending work.

**Rely on a store lock alone.** A lock only coordinates processes that honor it; the official desktop app cannot be assumed to do so. The process warning remains advisory, including when another process starts after the check.

## Consequences

The shortcut always selects the owner's standard home. An already-running server retains its own environment; opening its browser does not change its store. The launcher smoke executes the actual entry with synthetic process/listener queries and intercepted process launches, testing both desktop states without accessing session files or starting either app.
