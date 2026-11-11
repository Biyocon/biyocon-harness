# Public Conductor cost measurement

English | [中文](README.zh.md)

This reference owns the reproducible public experiment for [Detective result cost](../../.agents/notes/proposed/feature/2026-11-05-conductor-detective-evidence-budget.md). It measures the complete Conductor analysis, including the parent, producers, critic, Auditor, Arbiter, denied calls and rework. It changes no product runtime or record format.

## Prerequisites

Use Node 24, PowerShell 7, pnpm, ripgrep, two clean built runtime worktrees, and an inherited `DEEPSEEK_API_KEY`. Credentials stay in process environment; the runner neither loads a root `.env` nor writes a key. The experiment uses the official DeepSeek endpoint and requests `deepseek-flash` with high reasoning, native tools and no automatic provider retries. The provider may change the weights behind that model alias.

Build the selected revisions normally with `pnpm install --frozen-lockfile` and `pnpm run build` in each worktree. Baseline and candidate must stay clean and at their pinned commits throughout measurement. The runner boots their built headless example through the real Loader and mounts their shipped Conductor preset; it does not inject specialist answers or mock model responses.

## Prepare and run

The [generator](prepare-world.mjs) takes the baseline tree, candidate tree and an optional output parent. It creates a fresh random directory containing both public workspaces, an independent source/answer manifest, and separate home, agent, profile, temporary and session directories for every trial. It generates no owner session data. The complete source manifest and exact tasks remain local.

```powershell
$baseline = Join-Path $HOME 'worktrees\conductor-cost-baseline'
$candidate = Join-Path $HOME 'worktrees\detective-capture-index'
$prepared = node scripts/conductor-cost/prepare-world.mjs $baseline $candidate |
  ConvertFrom-Json
$experimentRoot = $prepared.root

foreach ($caseName in 'capture','discovery') {
  $order = @('baseline-1','candidate-1','candidate-2',
    'baseline-2','baseline-3','candidate-3')
  foreach ($attempt in $order) {
    $manifest = Join-Path $experimentRoot "$caseName-$attempt\manifest.json"
    & pwsh -NoProfile -File scripts/conductor-cost/launch-cost.ps1 -Manifest $manifest
    if ($LASTEXITCODE -ne 0) { throw 'Inspect the preserved trial before proceeding.' }
  }
}
pnpm run measure:conductor:report $experimentRoot
```

The [launcher](launch-cost.ps1) sets fresh `DSH_HOME`, `DSH_AGENTS_HOME`, home/profile and temporary environment variables. It does not start a browser/server or access the owner's application home. Each workspace has an empty `.git` directory to stop ancestor instruction discovery; user presets are disabled. An additional read-path guard restricts access to the synthetic workspace and that trial's state. The product's normal read-only analysis and approval guards remain active.

The [observer](cost-run.mjs) saves each model request and its final usage locally, passes stream chunks through unchanged, and flushes the real parent/child logs. A unique `started.json` prevents accidental repetition in the same trial directory. An external ten-minute/64-call/observed-USD-0.50 stop bounds the experiment; it is not an atomic product budget, can overshoot a response, and uses off-peak price equivalents. A stop, model failure or parked owner interaction remains a failed attempt, including its spent cost. Unknown usage stops the experiment and remains unpriced. Never delete `started.json` to retry a failed attempt; prepare a new, explicitly identified experiment instead.

## Cases and independent checks

| Case | Public input | Required findings | Purpose |
|---|---|---|---|
| `discovery` | 300 files, 30,216 body bytes, long paths, six subdirectories; no file admission | Three critical records with exact path and line | Broad search pressure and the source-result caps |
| `capture` | Three admitted files, 165,614 bytes, 1,200 lines each | One critical record in every source, with exact saved spans | Capture indexing when every source matters |

Run order alternates baseline/candidate, candidate/baseline, baseline/candidate. Remote provider caches cannot be reset, so report observed hits rather than claiming cold or equally warm caches. These controlled text tasks test specific source-selection behavior; they do not reproduce a private analysis or establish performance on arbitrary projects.

The [independent analyzer](../conductor-cost-report.ts) reconciles stream usage one-to-one with logged assistant messages by session/turn/step. It checks known IDs and exact one-line report locations, actual source exposure to the final producer, and saved capture hashes/ranges. Workspace discovery remains an observation, not admitted source verification. Denied calls, the current request and `structured_output` do not supply source support. An unrecognized report layout needs review rather than being automatically accepted.

The [report CLI](report.ts) rehashes the sources and checks the complete file inventory. Its oracle qualification covers these named findings only: it does not certify every semantic assertion, negative coverage claim or Auditor judgment. In particular, it does not implement the future claim-verification phase of #75. Review accepted reports for unsupported incidental claims separately before asserting equivalent overall quality.

## Price and publication

Rates checked **2026-11-11** on the [official pricing page](https://api-docs.deepseek.com/quick_start/pricing/) are USD 0.15 uncached input, USD 0.003 cache-read and USD 0.60 output per million tokens for Flash off-peak. Reasoning is a subset of output and is never charged twice. Cache-write counts are unreported by this adapter and remain absent, rather than assumed zero. Price totals are standard off-peak equivalents, not invoices or balance debits; peak periods and account credits can change actual charges.

Publish `report.json` only after inspecting it: it contains heads, source/driver hashes, per-call usage, character counts, tool counts/sizes, failures and aggregates, without source text, filenames, session IDs, prompts or reasoning text. Keep `raw.json`, `raw-incomplete.json`, full sessions and process logs local. The primary comparison divides the cost of **all** attempts by oracle-qualified completions; separately expose completion rates, individual prices, output and rework. Unknown usage makes the total price unknown. A percentage comparison is withheld until all three trials in both arms exist.

Small samples describe this experiment, not a guaranteed saving. A cheaper attempt that parks or omits a finding is not a cheaper completed analysis. The historical 12.58% source-cap estimate remains a separate counterfactual.

## Observed experiment: 2026-11-11

The [generated metadata](results/2026-11-11.json) compares baseline `879ab27bdd22203675d6f0cc678652779fc089cd` with A1+A2 candidate `41136d904cc28f8e528e7b14d6d6bcff9f34fd27`. All 317 calls request official Flash/high; stream and log usage reconcile, every source inventory/hash is unchanged, and no usage is unpriced. All twelve trials are retained; total standard off-peak equivalent is USD 0.528625383. The published observer is byte-identical to the executed driver, SHA-256 `79209899435feec7b7944addd07403a2fca8885ad605d51cddce4e443b6e76e7`.

| Case / arm | Qualified / attempts | Model calls | All-attempt USD | USD / qualified report |
|---|---:|---:|---:|---:|
| Discovery / baseline | 3 / 3 | 74 | 0.131939802 | 0.043979934 |
| Discovery / candidate | 3 / 3 | 77 | 0.096006795 | 0.032002265 |
| Capture / baseline | 3 / 3 | 74 | 0.162989202 | 0.054329734 |
| Capture / candidate | 2 / 3 | 92 | 0.137689584 | 0.068844792 |

Discovery is **27.23% cheaper** on this metric; no files are admitted, so the capture-index branch is inactive. Each accepted report has all three known findings and observed workspace sources. Detective search results reach 58,637 characters on baseline and at most 3,942 on candidate.

Capture is **26.72% more expensive** per qualified report despite lower mean attempt price. One candidate parks at owner escalation after structural span errors and critic rework; its USD 0.036620082 is included. Lower uncached input is offset by higher output and fewer completions. Candidate Detective search/capture results stay at or below 3,998 characters. The three known positive findings and saved spans are supported in both accepted candidate reports; the independent checks do not certify their other assertions.

This sample supports further evaluation of source caps and exposes a capture-heavy failure case. It does not establish general quality equivalence, validate the historical 12.58% number, or satisfy a blanket price acceptance for A2. Review the span/rework and completeness-language failures before changing guidance or defaults, then measure any revised candidate as a separately identified experiment without rewriting this result.

## Guidance follow-up: 2026-11-11

The [separate metadata](results/2026-11-11-guidance.json) compares the same baseline with candidate `adad7ff3f91025cf231417c624ce239c79a167b3`. The candidate clarifies current-request, non-overlapping saved spans and limits on completeness claims; validators, gates and rework budgets are unchanged. Both source hashes, tasks, model configuration and the frozen observer match the initial study. These are twelve fresh trials, not replacement attempts or pooled controls. All 289 calls reconcile with logs, source inventories/hashes are unchanged, and no usage is unpriced. Total standard off-peak equivalent is USD 0.615930048.

| Case / arm | Qualified / attempts | Model calls | All-attempt USD | USD / qualified report |
|---|---:|---:|---:|---:|
| Discovery / baseline | 2 / 3 | 45 | 0.085958973 | 0.0429794865 |
| Discovery / candidate | 3 / 3 | 86 | 0.129549651 | 0.043183217 |
| Capture / baseline | 3 / 3 | 83 | 0.190979736 | 0.063659912 |
| Capture / candidate | 3 / 3 | 75 | 0.209441688 | 0.069813896 |

Discovery is **0.47% more expensive** per qualified report. Baseline repetition three never starts a Conductor run; its two model calls and USD 0.000933597 remain charged to the denominator's two successful reports. It is not retried. Candidate search results stay within 3,943 characters, but that bound alone does not ensure a lower completed-run price.

Capture is **9.67% more expensive**, with all six reports passing the named source/span checks. Candidate Detective costs USD 0.072234234 versus baseline USD 0.077682300, while the other roles together cost USD 0.137207454 versus USD 0.113297436. These are observed call costs, not proof that the guidance caused a downstream change.

| Capture price component, all three trials | Baseline USD | Candidate USD |
|---|---:|---:|
| Uncached input | 0.097294800 | 0.091849800 |
| Cache-read | 0.012126336 | 0.006761088 |
| Output, including reasoning | 0.081558600 | 0.110830800 |

Output is the largest candidate component; its increase exceeds both input savings. Candidate capture/search results remain within 3,998 characters. Capture completion rises from the first study's 2/3 to this study's 3/3, but different controls, unpinned weights, cache state and small samples prevent attributing that change to guidance alone. The discovery branch has no admitted files and does not use capture guidance.

The two studies do not establish stable net savings for phase A or price acceptance for A2. Preserve both results for design review before another runtime change or experiment; neither an output ceiling nor excluding failed attempts demonstrates efficiency. Semantic claim verification remains outside this oracle's scope.
