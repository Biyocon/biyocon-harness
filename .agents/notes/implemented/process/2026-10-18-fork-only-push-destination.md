# Agent Note: Fork-only push destination

Status: implemented

English | [中文](2026-10-18-fork-only-push-destination.zh.md)

## Problem

The repository imports changes from `deepseek-ai/deepseek-harness`, but all Biyocon development must remain in `Biyocon/deepseek-harness`. Remote naming and account permissions reduce accidental publication risk, but neither establishes a versioned local rule for renamed remotes, direct URL pushes, or future credential changes.

## Decision

The upstream repository is fetch-only, and the Biyocon fork is the sole push destination. The pre-push validator inspects Git's remote location, recognizes only explicit GitHub HTTPS/SSH authorities or GitHub SCP syntax, rejects direct URL pushes, and allows only `Biyocon/deepseek-harness`. It preserves the raw path instead of applying browser URL repair, which can disagree with Git's transport selection. Lefthook runs the validator in a piped sequence before typecheck, so rejection prevents typecheck from starting.

The generated hook invokes `scripts/run-lefthook.mjs`. The dispatcher replaces inherited pre-push transport values with Git's original argument array encoded as JSON, then starts Lefthook shell-free with only `run pre-push`. The validator's script job has a fixed argument and reads that payload; neither the remote name nor location becomes shell syntax or a Lefthook option. Other hooks retain their arguments without the payload.

Upstream changes enter a new Biyocon integration branch through merge-forward. The integration starts from the exact Biyocon master commit, records the upstream commit, preserves fork features during conflict resolution, and reaches Biyocon master only through review and a separately authorized merge. Active feature branches merge-forward the updated Biyocon master without history rewriting.

## Alternatives considered

Relying only on the disabled `origin` push URL does not protect against a renamed remote or direct URL. Relying only on GitHub permissions makes safety depend on external account state. Renaming the existing remotes would break tracking configuration without strengthening destination validation. Rebasing or using GitHub's fork-sync action reduces the reviewable evidence that fork features survived the upstream import.

## Consequences

Named remotes resolving to the Biyocon fork work through the accepted HTTPS and SSH forms. Upstream, other repositories, ambiguous locations, direct URL pushes, and incomplete hook invocations fail locally. Run `node scripts/install-lefthook.mjs` after changing the dispatcher configuration to regenerate the worktree's owned hooks. Direct Lefthook calls, including `LEFTHOOK_BIN` overrides, fail without valid transport; the JSON payload does not authenticate its origin. Locally overridden hooks, forged payloads, `LEFTHOOK=0` and `--no-verify` can bypass the check, so repository policy and GitHub permissions remain necessary backstops. The allowlist intentionally excludes self-hosted mirrors and non-GitHub transports; adding a destination requires a reviewed code and policy change.

## Verification

`scripts/verify-push-destination.spec.ts` covers destination parsing and real installed-hook ordering, including hostile arguments, missing transport, inherited payloads and hook regeneration. `scripts/run-lefthook.spec.ts` covers process arguments, environment isolation, stdin and failure propagation. `scripts/install-lefthook.spec.ts` covers isolated worktree hooks and preservation of user-owned hook paths. Typecheck, lint, documentation synchronization, and whitespace checks cover the repository integration.
