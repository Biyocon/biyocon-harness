# Run initialization

Create or resume this record before Detective. The Conductor owns it; specialists never mutate it directly.

```yaml
record_format_version: 1
run_id: CON-YYYY-NNNN
objective: <concrete outcome>
scope: []
input_artifacts: []
allowed_paths: []
excluded_paths: []
authority:
  owner: <attribution only; not proof of authority>
constraints: []
acceptance_criteria: []
budget:
  max_rework_cycles: 3
  max_ralph_rounds: 0
source_baseline: null
execution_baseline: null
baseline_history: []
execution_authorization: null
current_stage: detective
history: []
specialist_reports: []
quality_executions: []
```

Use an existing `run_id` only when an unfinished run has the same objective. Resume only from the last documented valid gate.

Before the first dispatch, record the objective, proposed path limits, owner attribution, budget, and acceptance criteria. The owner string does not authorize writes, subprocesses, or external actions. Detective may establish an unknown source baseline; the execution baseline and its host authorization remain null until Gate C passes. A host approval binds the exact baseline hash, selected quality-command definition hashes, paths, and effect profile before any write-capable specialist or quality subprocess starts.
