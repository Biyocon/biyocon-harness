# Execution baseline

Create this record after Gate C. It is immutable until the Conductor explicitly approves a change.

```yaml
scopeVersion: <version>
planVersion: <version>
acceptanceVersion: <version>
allowedPaths: []
excludedPaths: []
rollbackReference: <commit, tag, or artifact>
qualityCommands:
  - id: <opaque deployment command id>
    definitionHash: <immutable command definition hash>
    requiredGates: [D, E]
```

The host resolves each selected id against the deployment catalog and records only the selected definition hashes; an unrelated catalog entry does not invalidate the baseline. Before Gate C passes, the host either approves the exact baseline hash and its derived `filesystem`, `quality`, and `external: none` effect profile or fails closed. The approval binds `allowedPaths`, `excludedPaths`, and the selected definitions; the model-provided owner label is attribution only. Quality execution always requests network denial and full sandbox enforcement. Headsman may only implement inside the approved baseline. If work requires a change outside it, stop and return a change request to the Conductor.
