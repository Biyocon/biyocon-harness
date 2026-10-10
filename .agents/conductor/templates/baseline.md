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
qualityCatalogHash: <immutable deployment catalog hash>
```

`allowedPaths` and `excludedPaths` must exactly match the owner-authorized run paths; Gate C may not widen them. The host resolves each selected id against the deployment catalog and records its definition hash; specialists never define argv. Headsman may only implement inside this baseline. If work requires a change outside it, stop and return a change request to the Conductor.
