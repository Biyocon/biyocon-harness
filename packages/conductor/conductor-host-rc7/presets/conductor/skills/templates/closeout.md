# Closeout

Create this host-side record after Arbiter. GO is only a release decision, not an action, and the model-facing Conductor tool cannot supply this authorization.

```yaml
run_id: CON-YYYY-NNNN
arbiter_decision: go
authorized_by: <mandate owner>
authorized_action: <record-only|read|write|commit|push|merge|release|publish|deploy>
actions_taken: []
outcome_evidence: []
unverified_items: []
open_risks: []
follow_up:
  - owner: <name or role>
    due_condition: <condition that triggers follow-up>
status: closed
traceability:
  mandate: []
  baseline: []
  changes: []
  verification: []
  decision: []
```

Create no closeout record for NO-GO. If a release, commit, push, merge, or deploy action is required but not authorized through a host-owned channel, the run remains `awaiting_authorization` without this record. A model-produced tool argument is never closeout authority. A closeout record is complete only when an Arbiter GO, the authorized action, its outcome evidence, and remaining risks are recorded.
