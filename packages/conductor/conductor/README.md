# @deepseek-ai/dsh-conductor

English | [中文](README.zh.md)

The Conductor runtime owns run state, gates A–G, defect-class rework routing, source and execution baselines, and explicit closeout records. `SessionConductorRunStore` appends a complete keyed checkpoint to the parent Session log and flushes after each transition; resume accepts only the last documented gate state and rejects terminal or escalated runs. Pre-release records carry an explicit format version and unsupported records are rejected without migration.

Specialists return `SpecialistEnvelope` values to Conductor and never choose the next specialist. Gate C proposes an immutable execution baseline containing deployment-resolved quality-command bindings and their definition hashes. Before Gate C can pass, the host must authorize the exact baseline hash and its effect profile: workspace writes when implementation is required, catalog quality execution when commands are bound, and no external effects. Rejection or an unavailable approval provider blocks the run before Headsman starts. Approved baselines remain in append-only history; scope or plan rework clears only the active baseline and authorization, preserving earlier evidence without allowing it to satisfy a later baseline.

Headsman and Auditor cite exactly the durable `QualityExecutionRecord` ids produced by their current dispatch rather than command text or earlier evidence. Gate D and Gate E each require fresh passing evidence for every command bound to that gate, and Gate E accepts only evidence produced by its independent Auditor cycle. Gate G records the Arbiter decision, and a GO remains `awaiting_authorization` until the mandate owner supplies outcome evidence and traceability through the host-owned closeout API. The runtime records closeout but performs no commit, push, merge, or deploy action. `ConductorAuthority` identifies the mandate owner only; it grants no execution or external-action capability.

## Known Limitations and Deferred Work

- Checkpoints are durable only when the host mounts a persistent Session provider; an in-memory Session retains them only for that process lifetime.
- Conductor records an authorized external closeout action and its evidence but deliberately does not execute release operations.
