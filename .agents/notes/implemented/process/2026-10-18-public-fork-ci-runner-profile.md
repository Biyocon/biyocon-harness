# Agent Note: Public-fork CI runner profile

Status: implemented

English | [中文](2026-10-18-public-fork-ci-runner-profile.zh.md)

## Problem

The primary CI workflow names organization-managed larger-runner labels and provides repository-variable failover to persistent self-hosted pools. A public fork owned by a personal account cannot allocate the organization runners, so without a fork-specific runner profile the four affected jobs remain queued. Reusing the self-hosted failover is unsafe because pull requests to a public repository can execute contributor-controlled workflow code, while the persistent runners retain credentials, network access, and host state between jobs.

## Decision

The three Linux Node 24 jobs, the `all checks passed` verdict, and the native Windows job use configured, enterprise, or self-hosted routing only when the pull-request head repository exists, its repository and owner IDs match the current repository context, and its `fork` field is the boolean `false`. Every missing, null, empty, differently typed, or mismatched value is untrusted and selects `ubuntu-24.04` or `windows-2025` with the public concurrency profile. A same-repository pull request in a repository that is itself a fork is therefore hosted-safe. The positive trust test precedes `DSH_CI_FAILOVER_LINUX` and `DSH_CI_FAILOVER_WINDOWS`, so repository variables cannot route untrusted work to persistent runners; explicitly trusted heads retain the Dependabot exception and variable-controlled failover behavior.

The public-fork profile limits Linux static gates to two concurrent gates, coverage to two test workers and one gate, consumer gates and linters to two workers, and snapshots to four workers. Native Windows uses one coverage worker, one gate worker, and two publint workers. These values fit the standard hosted runners' four CPUs without changing the larger-runner or self-hosted limits used by non-fork repositories.

Hosted cache restoration and Playwright dependency installation are the default for untrusted or unknown pull-request metadata even when a failover variable is present. Only the same positive repository, owner, and boolean non-fork test can select the self-hosted Playwright step. The non-PR self-hosted standby drills and organization-runner benchmarks retain their top-level `github.event.repository.fork == false` guards because those push and `workflow_dispatch` events have no pull-request head repository.

Before Playwright installs system dependencies, an additional preparation step runs only on GitHub-hosted Linux runners. [`prepare-ci-apt-mirrors.ts`](../../../../scripts/prepare-ci-apt-mirrors.ts) also refuses persistent or unknown runner environments before writing. It requires the image's existing Ubuntu mirror-list layout, prepends the Linux Kernel Archives' Ubuntu mirror at priority zero, and preserves the original mirror entries and Ubuntu source file, including suites, components and signing-key selection. A late-sorting APT fragment sets one retry and fifteen-second HTTP/HTTPS timeouts. The workflow checks the effective values with `apt-config` before package installation. No package-signature or validity check is disabled; the persistent failover VM retains its image-owned dependencies.

The Linux profile downloads Bubblewrap `0.9.0-1ubuntu0.3` from Ubuntu's security archive, falling back to the Linux Kernel Archives' Ubuntu mirror on transport or HTTP failure. The endpoints use different DNS domains, `ubuntu.com` and `kernel.org`, so failure to resolve one domain does not require the same DNS domain for recovery. Both locations must supply SHA-256 `2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094` before extraction. Each mirror permits two transfers with a five-second connection timeout, a fifteen-second transfer timeout, a one-second configured retry delay, and a twenty-second retry window. A transfer started within that window can finish after it, allowing approximately 70 seconds across both mirrors. A checksum mismatch stops immediately rather than trying another mirror. Exhausting both mirrors also stops preparation before the executable path, AppArmor setting, or Bubblewrap probe can change.

## Alternatives considered

**Register permanent self-hosted runners in the public fork.** Rejected because contributor-controlled pull requests could execute on persistent machines. Repository membership is no longer a sufficient trust control once forking and external contributions are available.

**Use organization-managed larger runners from the personal fork.** Rejected because the labels belong to the upstream organization and larger runners are not available to a personal-account repository.

**Replace the enterprise topology for every repository.** Rejected because the existing non-fork pools and failover switches remain useful and already have independent readiness checks. The fork predicate can isolate the public-fork policy without weakening or duplicating that behavior.

**Depend on one immutable Launchpad Librarian object or two hosts under ubuntu.com.** Rejected because artifact identity does not provide network availability, and both Ubuntu-hosted names can fail DNS resolution in the same CI run. Independently operated archive mirrors retain the same pinned bytes while bounded retries prevent a small dependency download from blocking CI for many minutes. Neither an unverified mirror nor an unpinned package-manager installation can substitute for the required checksum.

**Keep the image's APT mirror order or rewrite its sources.** The stock Azure, archive and security endpoints can all depend on unavailable Ubuntu DNS. Preferring an independently operated mirror in the existing list addresses that failure without rewriting repository suites, signing keys or unrelated package sources.

## Consequences

Untrusted pull-request heads can run the primary keyless CI on ephemeral GitHub-hosted machines, but the four affected jobs have less CPU capacity and may take longer. Secret-backed real-API E2E remains skipped for fork and Dependabot pull requests. Fork repositories do not run the self-hosted standby drills or organization-runner benchmarks. The workflow test pins the positive repository/owner/non-fork trust test, hosted-safe defaults, concurrency, setup, and the non-PR guards so later failover edits cannot silently restore persistent-runner routing for unknown or untrusted heads.

The Ubuntu archives can retire a superseded package version. If both pinned locations disappear, CI fails explicitly until a maintainer reviews a replacement version and checksum; it never silently installs the latest package. A successful preparation still requires the real Bubblewrap confinement probe.

APT preparation supports the hosted image's mirror-list layout explicitly; an incompatible image fails setup rather than silently keeping broken routing. A mirror that cannot supply fresh, correctly signed repository metadata still fails ordinary APT verification.

## Verification

`scripts/ci-workflow.spec.ts` parses the assembled workflow and verifies that each public-fork runner selection precedes the failover variable, that conservative worker limits are present, that hosted Playwright setup remains active, and that persistent-host and enterprise benchmark jobs require a non-fork repository. `scripts/prepare-ci-bubblewrap.spec.ts` invokes the real preparation script with isolated command fixtures and verifies the pinned artifact, bounded curl options, replacement of a partial download during mirror failover, immediate checksum refusal on either mirror, exhaustion refusal, and operation order without network access. Repository validation also runs typecheck, lint, documentation synchronization, change-scope, and whitespace checks.

`scripts/prepare-ci-apt-mirrors.spec.ts` exercises the real filesystem and Node entry with isolated APT trees: preference and source preservation, idempotence, and refusal of persistent hosts, unknown environments, unsupported layouts and empty lists. Workflow assertions require the ephemeral Linux condition, effective-timeout checks and ordering before Playwright; no other job invokes this preparation.
