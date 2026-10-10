# Gate decision

The Conductor records one decision per gate. A specialist's recommendation never replaces this record.

```yaml
run_id: CON-YYYY-NNNN
gate: A
# A | B | C | D | E | F | G
stage: detective
decision: pass
# pass | rework | escalate | abort
basis: []
evidence_reviewed: [<artifact or quality execution record id>]
defect_class: null
# scope | plan | implementation | delivery | null
next_stage: strategist
state_update: <short concrete change>
```

`pass` requires fresh, relevant evidence against the acceptance criteria. Gate D and Gate E require a passing record for every binding assigned to that gate in the current cycle; Gate E accepts only records produced by the fresh Auditor dispatch. Use `rework` for a bounded known defect, `escalate` when authority or scope needs an owner decision, and `abort` when further work is not defensible.
