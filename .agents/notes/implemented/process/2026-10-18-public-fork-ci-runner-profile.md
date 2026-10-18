# Agent Note: Public-fork CI runner profile

Status: implemented

English | [中文](2026-10-18-public-fork-ci-runner-profile.zh.md)

## Problem

The primary CI workflow names organization-managed larger-runner labels and provides repository-variable failover to persistent self-hosted pools. A public fork owned by a personal account cannot allocate the organization runners, so without a fork-specific runner profile the four affected jobs remain queued. Reusing the self-hosted failover is unsafe because pull requests to a public repository can execute contributor-controlled workflow code, while the persistent runners retain credentials, network access, and host state between jobs.

## Decision

When `github.event.repository.fork` is true, the three Linux Node 24 jobs and the `all checks passed` verdict run on `ubuntu-24.04`, and the native Windows job runs on `windows-2025`. The fork test is the first branch in each runner selector, before `DSH_CI_FAILOVER_LINUX` or `DSH_CI_FAILOVER_WINDOWS`, so repository variables cannot route public-fork work to a self-hosted runner. Non-fork repositories retain the existing enterprise labels, Dependabot exception, and variable-controlled failover behavior.

The public-fork profile limits Linux static gates to two concurrent gates, coverage to two test workers and one gate, consumer gates and linters to two workers, and snapshots to four workers. Native Windows uses one coverage worker, one gate worker, and two publint workers. These values fit the standard hosted runners' four CPUs without changing the larger-runner or self-hosted limits used by non-fork repositories.

Hosted cache restoration and Playwright dependency installation follow the public-fork branch even when a failover variable is present. Self-hosted standby drills and organization-runner benchmarks require `github.event.repository.fork == false`, preventing a public fork from dispatching either persistent-host or unavailable enterprise-label work.

## Alternatives considered

**Register permanent self-hosted runners in the public fork.** Rejected because contributor-controlled pull requests could execute on persistent machines. Repository membership is no longer a sufficient trust control once forking and external contributions are available.

**Use organization-managed larger runners from the personal fork.** Rejected because the labels belong to the upstream organization and larger runners are not available to a personal-account repository.

**Replace the enterprise topology for every repository.** Rejected because the existing non-fork pools and failover switches remain useful and already have independent readiness checks. The fork predicate can isolate the public-fork policy without weakening or duplicating that behavior.

## Consequences

Public forks can run the complete pull-request workflow on ephemeral GitHub-hosted machines, but the four affected jobs have less CPU capacity and may take longer. Fork repositories do not run the self-hosted standby drills or organization-runner benchmarks. The workflow test pins runner-selection precedence, fork concurrency, hosted setup, and the non-fork guards so later failover edits cannot silently restore self-hosted routing for public forks.

## Verification

`scripts/ci-workflow.spec.ts` parses the assembled workflow and verifies that each public-fork runner selection precedes the failover variable, that conservative worker limits are present, that hosted Playwright setup remains active, and that persistent-host and enterprise benchmark jobs require a non-fork repository. Repository validation also runs typecheck, lint, documentation synchronization, change-scope, and whitespace checks.
