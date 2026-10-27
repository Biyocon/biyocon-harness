# Run initialization

Create or resume this record before the admitted first specialist. The Conductor owns it; specialists never mutate it directly.

```yaml
record_format_version: 3
admission:
  purpose: implementation | analysis
  entry: detective | strategist | devils-advocate
  deliverable: answer | recommendations; analysis only
  rationale: <entry justification>
  materials: <host-captured current request and cited files, with ids, contents, hashes and provenance>
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
  max_rework_per_gate: 2
  max_ralph_rounds: 0
source_baseline: null
execution_baseline: null
baseline_history: []
execution_authorization: null
current_stage: detective
history: []
specialist_reports: []
quality_executions: []
analysis_reports: []
report_candidates: []
repair_returns: []
```

Use an existing `run_id` only when an unfinished run has the same objective. Resume only from the last documented valid gate.

Purpose, entry, deliverable and captured inputs remain immutable across resume. Unsupported record format 2 requires a new run; there is no migration. Analysis retains null execution baseline/authorization and empty quality evidence, never asks for approval, and ends with an independently audited `reported` result rather than GO or closeout. Per-gate rework counts and causal repair returns survive resume.

Before the first dispatch, record the objective, proposed path limits, owner attribution, budget, and acceptance criteria. The owner string does not authorize writes, subprocesses, or external actions. Detective may establish an unknown source baseline; the execution baseline and its host authorization remain null until Gate C passes. A host approval binds the exact baseline hash, selected quality-command definition hashes, paths, and effect profile before any write-capable specialist or quality subprocess starts.
