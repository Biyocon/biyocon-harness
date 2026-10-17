---
name: conductor-ralph
description: Kør en afgrænset, iterativ implementeringssløjfe med friske workers inden for en Conductor-godkendt execution baseline.
---

# Conductor Ralph

Brug denne skill kun under Headsman-stagen, når et godkendt work package er for stort eller for usikkert for én execution-session, men stadig er afgrænset nok til iteration. Ralph er en execution primitive, ikke en organisatorisk rolle, en gate-ejer eller en erstatning for Auditor.

## Forudsætninger

Start ikke Ralph før Gate C er passeret, og Conductor har leveret:

```yaml
run_id: CON-YYYY-NNNN
work_package: <id og mål>
baseline: <scope, plan, acceptkriterier og tilladte områder>
constraints: []
quality_command_ids: []
stop_conditions: []
max_rounds: <positivt heltal>
allowed_actions: []
prohibited_actions: [scope_change, release]
```

Hvis work package ændrer arkitektur, krav eller autoriseret ændringsområde, er det ikke Ralph-arbejde. Returnér en change request til Conductor.

## Rundeprotokol

Hver runde starter en fresh worker med det immutable work package, aktuelle workspace-state, rundenummer og den seneste strukturerede handoff. Del ikke ukontrolleret samtalehistorik som erstatning for en handoff.

Hver worker skal:

1. inspicere den aktuelle state;
2. udføre den mindste næste handling mod baselinen;
3. køre relevante quality commands ved kun at kalde den private `conductor_quality_check` med et tildelt opaque `command_id`;
4. returnere ændringer, evidens, resterende arbejde og blockers i struktur;
5. stoppe ved scope- eller myndighedsafvigelser.

Registrér rundernes output. Stol ikke på en workers egen `complete`-erklæring som bevis for, at leverancen accepteres.

```yaml
run_id: CON-YYYY-NNNN
round: 3
status: continue
# continue | complete | blocked | failed
changes: []
evidence: []
remaining_work: []
blockers: []
next_handoff: <kort struktureret state>
```

Stop på `complete`, `blocked`, `failed` eller `max_rounds`. Ved `complete` afleverer Headsman en almindelig implementation report til Conductor. Conductor sender derefter arbejdet til en uafhængig Auditor; Ralph må ikke selv passere Gate D eller E.

Ralph må aldrig levere rå command text, argv eller ekstra argumenter. Hostens deployment-katalog ejer den eksakte kommando, cwd, effect profile og grænser; den aktive host-autorisation skal matche execution-baseline-hashen. Quality execution kræver netværksforbud og fuld sandbox-håndhævelse og afvises før spawn, hvis hosten ikke kan levere begge. Ralph kan producere Gate-D-evidens under Headsman, men ejer ingen gate og kan ikke levere Gate-E-evidens.
