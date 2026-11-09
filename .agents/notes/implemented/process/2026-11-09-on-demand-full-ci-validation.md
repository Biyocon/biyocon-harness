# Agent Note: On-demand full CI validation

Status: implemented

English | [中文](2026-11-09-on-demand-full-ci-validation.zh.md)

## Problem

The CI workflow runs its complete test matrix on pull requests. On a push to Biyocon's fork master, its PR jobs and non-fork standby jobs are skipped, so a successful workflow result does not validate the exact merge commit. Separate green PR heads do not execute the combined tree. Running the entire suite locally cannot substitute for hosted Linux and native Windows results.

## Decision

The existing `workflow_dispatch` suite offers `full-validation`. It runs the same static, coverage, consumer, Node compatibility, Python, Wine, and native Windows jobs as a pull request on the selected ref. The existing `all checks passed` job retains its required PR dependencies; a separate manual verdict also requires native Windows to succeed. The static archive check uses the PR base for pull requests and the selected commit for a manual run. Without a trusted PR head, runner selection stays on GitHub-hosted pools.

Master pushes retain their lightweight job selection. To validate a merged head, dispatch `gh workflow run CI --repo Biyocon/biyocon-harness --ref master -f suite=full-validation` and compare the run's head SHA with the intended master SHA before accepting its result. The workflow's existing run-level concurrency may cancel an in-progress run on the same ref when a manual dispatch starts; the [CI failover runbook](2026-07-26-ci-failover-runbook.md) records that limit.

## Alternatives considered

**Run the full matrix automatically on every master push.** This adds recurring hosted-runner cost and changes the tested bound on uncancelled push runs. The manual suite provides exact-commit evidence when needed without changing push behavior.

**Treat PR-head checks or local tests as merge-commit checks.** Neither executes the exact merged tree in the hosted matrix, so neither establishes that claim.

## Consequences

Full merged-head evidence requires an explicit dispatch and a matching head SHA. The manual verdict fails if either the required PR matrix or native Windows fails, is cancelled, or is skipped. A plain master-push CI success remains a lightweight signal and must not be reported as full validation.
