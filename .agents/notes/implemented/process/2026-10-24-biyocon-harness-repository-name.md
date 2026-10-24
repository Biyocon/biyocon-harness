# Agent Note: Biyocon fork identity and checkout location

Status: implemented

English | [中文](2026-10-24-biyocon-harness-repository-name.zh.md)

## Problem

A fork rename changes the repository identity accepted by the local push guard. Moving its Windows checkout also invalidates absolute dependency links, generated hook paths, workspace registrations, and shortcuts. GitHub redirects do not repair these local references or preserve the guard when its configured hook path is absent.

## Decision

The versioned push allowlist selects `Biyocon/biyocon-harness`, and local launcher examples use `C:\Users\Biyocon\biyocon-harness`. The remote alias remains `biyocon`; `deepseek-ai/deepseek-harness` remains fetch-only. Package names, `dsh`, `.dsh`, product terminology, archived notes, and Conductor execution logs are outside this naming change.

The GitHub repository rename and the named remote's URL update precede publication of this policy. The validator checks the literal destination rather than following redirects, so the former fork identity is rejected. Local preparation and commits do not rename the remote repository or checkout; those operations require separate owner action.

The checkout moves only after the source changes are merged and local master is fast-forwarded, with Codex and the app stopped. Dependency installation and `node scripts/install-lefthook.mjs` restore checkout-local links and owned hooks at the destination. The relocated checkout's `core.hooksPath` must resolve to its own `.git/dsh-hooks`; workspace registration and shortcuts must reference the new location. Hook bypass is not a relocation procedure.

The [fork-only push decision](2026-10-18-fork-only-push-destination.md) remains active because its transport, credential-redaction, dispatcher, and upstream-integration rationale is independently useful. This decision replaces only its concrete fork identity.

## Alternatives considered

**Allow both names or rely on redirects.** A redirect does not change the destination string supplied to the local guard. Keeping both identities admitted would retain an obsolete publication target instead of enforcing the selected repository.

**Rename the whole product.** Package identifiers, runtime commands, home directories, and upstream references have separate consumers and meanings. Renaming them is unnecessary for identifying the Biyocon fork and Windows checkout.

## Consequences

The prepared branch cannot publish to the former fork URL. Repository and checkout relocation remain explicit operations with different timing; a successful local commit proves neither has happened. The old repository name must not be reused for another GitHub repository while existing links depend on its redirect.

## Verification

The destination specs cover accepted HTTPS/SSH forms and former-fork rejection through both the validator and a real installed hook before typecheck. Dispatcher and hook-installer tests retain their argument-isolation and worktree-local-path checks. The keyless translation-prompt snapshot is refreshed through its runnable scenario because it embeds the development guide. Documentation pairing, doc-sync, lint, and typecheck cover the remaining integration.
