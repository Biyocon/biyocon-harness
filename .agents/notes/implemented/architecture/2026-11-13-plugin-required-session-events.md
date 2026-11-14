# Agent Note: Required session events from optional plugins

Status: implemented

English | [中文](2026-11-13-plugin-required-session-events.zh.md)

## Problem

A repository-wide event allowlist admits Conductor history even when its host bundle is absent. Required owner and run events can then appear readable without their interpretation. An optional packaged plugin also needs to declare events outside the host build without weakening unknown-event refusal.

## Decision

The [session store](../../../../packages/core/session/README.md) admits built-in types plus declarations registered by mounted plugins through `registerEventTypes`. Registrations belong to the calling fiber, are reference-counted and disappear with the final registrant. They authorize vocabulary interpretation, not payload validity, owner actions or migration. Trusted same-process plugins declare their types through TypeScript; untrusted envelopes remain subject to storage and domain validation.

The catalog generator excludes packages declaring `dsh.sessionEventRegistration: true` from unconditional runtime admission while retaining their documentation. Explicit profile bundles declare `dsh.bundle.sessionEventTypes`; [app-boot](../../../../packages/boot/app-boot/README.md) validates arrays, combines names once and supplies ordinary SessionStore Config before activation. Transitive dependencies and patches grant no names; declarations without an enabled session provider refuse startup. The existing rc.7 Loader supports this configuration flow without provider replacement.

Conductor event admission has one owner: bundle manifests through session Config. [Conductor](../../../../packages/conductor/conductor/README.md) owns only its two projections and their `conductorPresentation` availability; the bundle uses the existing row-level `inject` dependency to prevent session activation before projection registration. Neither metadata nor projections are registered twice. Importing types or having packages on disk grants no admission. Existing Biyocon profiles retain the explicit bundle.

The shared [persistence coordinator](../../../../packages/session/session-persistence/README.md) checks admission before constructing cold sessions, synthesizing or committing recovery, publishing agents or replaying projections. Retained preparations and live inspections also recheck registrations. SQLite suffix reads report required prefix types with their first sequence numbers, so a projection watermark cannot hide an earlier unsupported event. JSONL checks the complete parsed prefix. Missing registration names the event and asks for a compatible bundle or host upgrade; it never returns partial history. `ignorable: true` retains its existing meaning.

With the bundle, unsupported or invalid Conductor run records preserve chat and the unavailable-run projection; actual run access remains strictly refused. Session and Conductor format versions remain unchanged. Read-only inspection changes no stored bytes. Initial agent resume can append the existing `session/end-seed` marker without changing original bytes; the qualified cold restart adds nothing and repeats no model or tool work.

## Alternatives considered

**Unconditional optional-event names in core.** Knowing a name does not install its interpreter; keep the required-bundle rule without core importing Conductor.

**Skip unknown events or rewrite old records.** Either can lose authority facts or damage history; refuse before replay and leave original records intact.

**Validate only a cached suffix.** Required events before its watermark would escape admission; carry prefix-type witnesses without decoding prefix payloads again.

## Verification

The [keyless runnable example](../../../../examples/headless-agent/conductor-event-admission.cordis.snapshot.yml) and its [snapshot suite](../../../../examples/headless-agent/tests/conductor-event-admission.snapshot.ts) cover current history with/without the actual bundle patch, ordinary chat without it, format 4 and invalid records with it, and independent process restart. The [Web startup regression](../../../../apps/web/tests/conductor-event-admission.e2e.ts) proves reads wait for projections, then work before full boot settles; rejection publishes no session and changes neither stored bytes nor cache entries. Real CLI composition proves two explicit bundles work together while transitive and patch declarations grant nothing. Provider disposal, metadata rejection and cold/cached/suffix reads are covered across JSONL and SQLite. No model or tool executes.

## Consequences

Optional event producers must ship and mount their registration plugin before session access. SQLite adds a grouped prefix-type query to suffix reads. Packed installation gates 4a/4b, UI extraction and adapters remain separate; this is not a public-release or paid-test qualification.

Supersession audit: this decision partially replaces the generated-list-only admission and deferred-registration alternative in the [session format decision](2026-08-10-session-log-version-mechanism.md); its format, ignorable-marker and intact-log refusal rules remain active. The [unavailable-history decision](../bug-fix/2026-11-06-conductor-unsupported-record-history.md) retains strict run access, and the [rc.7 bundle decision](2026-11-12-conductor-rc7-host-bundle.md) retains assets, trust and migration. No complete implemented triplet is superseded or archived.
