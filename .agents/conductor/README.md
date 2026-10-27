# Conductor-team

Dette er et sæt tilpassede rolle-instruktioner til en Conductor-session. Hver rollefil bærer frontmatter (`name: conductor-*`, `description`, `disable-model-invocation: true`) og loader derfor som en skill gennem filesystem-skill-provideren, som Conductor-preset'en (`apps/cli/config/agent-presets/conductor/agent.cordis.yml`) monterer; rollekroppen forbliver en manuel prompt. Filerne håndhæver ikke værktøjsrettigheder.

[Intake og rapportafslutning i fase 1](../notes/implemented/feature/2026-10-25-conductor-intake-and-report-completion.md) ejer de tilladte ruter, indfanget input og den terminale rapports betydning.

## Ejerskab og routing

Den aktive Codex-agent er **The Conductor** og ejer intake, workflow-state, handoffs, gates, baseline, evidens, rework og eskalering. Brugeren ejer mandatet og autoriserer ændringer. Specialister arbejder kun på en afgrænset arbejdspakke og afleverer altid tilbage til Conductor; ingen specialist sender arbejde direkte til den næste specialist.

Conductor indlæser den relevante rollefil og specialistkontrakten ved delegation. Parallelle skriveopgaver kræver hver sit eksplicitte `allowed_paths`-område.

## Intake og arbejdspakke

Før første specialist fastlægger Conductor en arbejdspakke med:

```yaml
record_format_version: 3
admission:
  purpose: implementation | analysis
  entry: detective | strategist | devils-advocate
  deliverable: answer | recommendations; analysis only
  rationale: why the supplied material supports this entry
  materials: host-captured current request and explicitly cited workspace files with ids, content and SHA-256
run_id: unique-id
objective: concrete outcome
scope: included work
allowed_paths: []
excluded_paths: []
source_baseline: version or commit reference, or null until Detective establishes it
execution_baseline: null
baseline_history: []
execution_authorization: null
acceptance_criteria: []
constraints: []
input_artifacts: []
authority:
  owner: mandate-owner attribution only
```

Conductor-modellen foreslår formål og indgang; kode validerer kombinationen og vælger ruten. Uklart nyt arbejde starter ved Detective; manglende scope- eller planmateriale ved en senere indgang giver afgrænset rework til den ansvarlige tidligere rolle. Runtime binder `current-request` til den faktiske brugerbesked og læser kun eksplicit henviste tekstfiler inden for arbejdsområdet, med grænser for antal og bytes. Indhold, hashes og meddelelsens provenance gemmes før dispatch; de identificerer disse input, ikke hele arbejdsområdets ukommittede tilstand. Auditor-indgang, verification og komplette dirty/non-Git-manifester understøttes ikke.

`authority.owner` er attribution og kan ikke give modellen skriveret, subprocess-adgang eller ekstern myndighed. Ved implementation etablerer Detective en ukendt source-baseline; ved senere indgang identificerer intake-hashen alene de indfangede input. Eksekveringsbaseline og host-autorisation opstår først ved en rigtig Gate C-vurdering og godkendelse. En oversprungen gate registreres som `kind: skipped` med begrundelse, materialereferencer og rute; den er aldrig et pass eller en godkendelse.

## Handoff

Implementation-resultater bruger envelopen nedenfor og identificerer den vurderede version. Analysis bruger det formålsbestemte rapportskema i [specialistprotokollen](../skills/conductor-specialist/SKILL.md): et svar går producent → Auditor → The Arbiter; anbefalinger med indgang Detective går Detective → Strategist → Auditor → The Arbiter. Gate C er her rapportvurdering, ikke eksekveringsgodkendelse. Ingen analyse når Headsman, Ralph, Integrator, kvalitetskommandoer eller en approval.

Operative templates:

- [Run initialization](templates/run.md)
- [Specialist dispatch](templates/dispatch.md)
- [Specialist envelope](templates/specialist-envelope.md)
- [Gate decision](templates/gate-decision.md)
- [Execution baseline](templates/baseline.md)
- [Closeout](templates/closeout.md)

```yaml
run_id: unique-id
stage: detective|strategist|devils-advocate|headsman|auditor|integrator|arbiter
baseline_ref: source or execution baseline actually assessed
source_baseline: optional; ready Detective only when intake omitted it
status: ready|rework|blocked|failed
summary: concise result
evidence: []
findings: []
assumptions: []
blockers: []
artifacts: []
change_requests: []
execution_baseline: optional; ready Devil's Advocate only at Gate C
quality_evidence_ids: []
recommended_transition:
  target: conductor
  rationale: what Conductor should evaluate
confidence: low|medium|high
```

Conductor bevarer hvert valideret specialistresultat som en del af run-recorden og sender de tidligere reports til den næste specialist og Arbiter. Conductor registrerer separat hver gate `A`–`G` med `stage`, `decision: pass|rework|escalate|abort`, en kort `basis`, `next_stage` og den aktive execution-baseline-hash, når en baseline gælder. `ready` bliver kun til et gate-pass, når runnet har acceptkriterier og specialisten leverer konkret evidens. Gate C kan foreslå opaque quality-command-id'er fra runtime-kataloget; hosten binder de valgte definition hashes og godkender den eksakte baseline, før Headsman starter. Headsman/Ralph og den uafhængige Auditor kan kun køre bindings gennem den private `conductor_quality_check`, som afviser rå kommandoer, kræver netværksforbud og fuld sandbox-håndhævelse. Gate D og E kræver hver deres friske, beståede records fra den aktuelle dispatch, citeret via `quality_evidence_ids`; Ralph kan kun bidrage til Gate D. Scope- eller plan-rework deaktiverer den aktive baseline og dens autorisation, men bevarer baselinehistorik og evidens til audit; historisk evidens kan ikke opfylde en ny baseline. Rework går til den ansvarlige for fejlen: scope til Detective, plan til Strategist, implementering til Headsman og leverancepakke til Integrator.

En strukturelt ugyldig rapport sendes til samme rolle som `report`-rework. `maxReworkPerGate` begrænser rework pr. gate; presettet tillader to, og tredje afvisning eskaleres. Gate C-forslaget udelader `allowedPaths` og `excludedPaths`: runtime kopierer kun ejerens stier og exclusions. Identitets-, baseline- eller autoritetsbrud og afvist host-godkendelse eskaleres straks. Slutresultatet viser run-id, nået stage, gate-beslutninger med begrundelser og de specialister, der har leveret et gate-resultat, også når rapporten blev afvist.

## Rettigheder og stopregler

Ved analyse vurderer The Arbiter den præcise ReportCandidate og en uafhængig audit med `accept | revise | blocked`. Accept ender i `reported` og `report-complete`, uden GO, closeout eller handlingstilladelse. Rapportrevision går til producenten og derefter gennem en ny Auditor-vurdering. Forudsætnings-rework bevarer returvejen, fx C → B → C eller C → B → A → B → C, og hver gate bruger sit eksisterende rework-budget. Efter ethvert resultat er hovedagentens værktøjer fortsat afvist indtil en ny brugeropgave.

Rollefilerne beskriver adfærd, men giver ingen teknisk adgang. Headsman må kun skrive i arbejdspakkens autoriserede scope. Auditor er uafhængig og ændrer ikke produktkode. Integrator må kun samle afgrænsede dokumenter, når arbejdspakken tillader det; ingen rolle committer, merger, pusher eller publicerer uden særskilt autorisation. The Arbiter læser evidens og afgiver `GO` eller `NO-GO`; en `GO` udvider ikke mandatet og udløser ikke release.

## Roller

- [Detective](roles/01-detective.md) — `ClarificationReport`
- [Strategist](roles/02-strategist.md) — `PlanPackage`
- [Devil's Advocate](roles/03-devils-advocate.md) — `ChallengeReport`
- [Headsman](roles/04-headsman.md) — `ImplementationReport`
- [Auditor](roles/05-auditor.md) — `VerificationReport`
- [Integrator](roles/06-integrator.md) — `DeliveryPackage`
- [The Arbiter](roles/07-the-arbiter.md) — `DecisionRecord`

## Profilbilleder

[Profilmanifestet](roles/profiles.yml) knytter The Conductor og de syv specialistroller til lokale 512×512 WebP-billeder. Hver specialistfil bærer samme `metadata.displayName` og relative `metadata.avatar`; filesystem-skill-provideren bevarer metadataene og skillens `resourceBase`. Billedstierne er relative til `roles/` og afhænger ikke af en bestemt maskine eller worktree.

Dette er statiske rolledata, ikke en avatarfunktion i klienten. Conductor-dispatch, sessions, descriptors, API'er og UI er uændrede; manifestet indlæses ikke automatisk, og billederne erstatter ikke klienternes ikoner. Billedernes oprindelse, optimering og afgrænsning er beskrevet i [Agent Note om profilassets](../notes/implemented/feature/2026-10-24-conductor-role-profile-assets.md).

Arkitekturens sporede design og runtimebeslutninger findes i [Conductor Agent Note](../notes/implemented/feature/2026-09-11-conductor-runtime-layer.md). Projektets stående regler findes i [AGENTS.md](../../AGENTS.md).
