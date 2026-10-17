# Specialist dispatch

Give every specialist a self-contained package. Assume the child does not inherit parent context.

```yaml
run_id: CON-YYYY-NNNN
stage: <detective|strategist|devils-advocate|headsman|auditor|integrator|arbiter>
objective: <bounded task>
scope: []
input_artifacts: []
previous_specialist_reports: []
source_baseline: <version, commit reference, or null>
execution_baseline: <Gate-C record or null>
allowed_paths: []
excluded_paths: []
allowed_actions: <stage allowlist intersected with the host-approved execution effect profile>
prohibited_actions: [commit, push, merge, release, publish, deploy, shell, <every action outside the approved effect profile>]
acceptance_criteria: []
constraints: []
questions_to_resolve: []
required_evidence: []
quality_command_bindings: []
return_format: specialist-envelope
```

Load the matching role file as the child persona and the specialist skill as the envelope contract. Use fresh spawn for every specialist. A write-capable child or quality subprocess requires an active host authorization matching the baseline hash. A quality binding exposes only its opaque id and model-safe description; the private tool resolves exact argv, requests network denial, and accepts no raw command or extra arguments. Never let one specialist send work directly to another; every result returns to the Conductor.
