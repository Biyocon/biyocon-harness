# @deepseek-ai/dsh-client-ui-conductor-subagent

English | [中文](README.zh.md)

This client plugin owns Conductor role names, attempt labels and lifecycle/gate text in the subagent catalog. It contributes to the generic subagent.catalog.content chain; the owner passes exact parent/child data and text styling identifiers, without interpreting Conductor stages. Its selector accepts only children attributed by the host's conductorChildren projection. An absent match leaves the ordinary subagent rendering intact.

EN/DA text shows each attempt separately. Running children have no inherited gate; Ralph has no specialist gate. Exact child identifiers remain in secondary text. The catalog names the row through the rendered text and exact metrics using aria-labelledby, so status is accessible without color. Both slot registration and dictionaries are disposed with the plugin fiber. [The decision](../../../.agents/notes/implemented/bug-fix/2026-10-28-conductor-child-role-status.md) owns attribution and persistence.

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
