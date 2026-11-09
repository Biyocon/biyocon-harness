# @deepseek-ai/dsh-client-ui-conductor-subagent

English | [中文](README.zh.md)

This client plugin owns Conductor role names, attempt labels and lifecycle/gate text in the subagent catalog. It contributes to the generic subagent.catalog.content chain; the owner passes exact parent/child data and text styling identifiers, without interpreting Conductor stages. Its selector accepts only children attributed by the host's conductorChildren projection. An absent match leaves the ordinary subagent rendering intact.

The plugin also reads the model-hidden `conductorUnavailableRuns` projection and shows unavailable saved runs in a panel above the composer and in the session header, which remains visible with Forløb selected. EN/DA text identifies the runId and says it cannot be resumed with the stored format number, or unknown format when none is readable. The panel offers no action on the old run. [The decision](../../../.agents/notes/implemented/bug-fix/2026-11-06-conductor-unsupported-record-history.md) owns strict reuse rejection.

EN/DA text shows each attempt separately. Running children have no inherited gate; Ralph has no specialist gate. Exact child identifiers remain in secondary text. The catalog names the row through the rendered text and exact metrics using aria-labelledby, so status is accessible without color. Both slot registration and dictionaries are disposed with the plugin fiber. [The decision](../../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md) owns attribution and persistence.

The catalog shows producer/critic mode and pending, unvalidated, holding, not holding or escalated critique with EN/DA text. Validated findings come from the exact child gate event; summary, claim and rationale remain literal text, and severity labels do not depend on color. The host binds these facts to the stored challenge before publication. The complete challenge and its digest share the checkpoint flush and are revalidated for projection; reload preserves the same findings. The focused tree row announces the summary and each finding as well as showing them.

## Model Experience

### Catalog text

#### What the model sees

The contribution reads `conductorChildren` and changes only browser text. It adds no prompt, model token or authorization and does not modify earlier model requests.

#### Token effect

Zero model tokens.

#### KV Cache effect

None; model requests are unchanged.

## Known Limitations and Deferred Work

- Unattributed historical children retain the generic display. Avatars and a team view are separate features.
