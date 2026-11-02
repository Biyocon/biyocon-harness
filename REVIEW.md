# Review: workspace action hover race (#57)

## Commit comparison

The full `apps/web/tests/workspace-management.e2e.ts` file ran 11 times at each unchanged product commit. `biyocon/master` `739d18bfb319211a04b1ca9905d1b2e5135351a1` passed 11/11 runs; P2a head `d56b0b80e039b2e87be8ffc7416f64cc8f6b365b` passed 10/11. Its one failure was the `Workspace actions for alpha-ws` click timeout. This small local sample does not establish a material change in failure rate. No Web, Workspace, or session-creation code changed in P2a; its new token-limit and reserved-child-id paths are unused by this model-free browser scenario.

The latest master push [CI run](https://github.com/Biyocon/biyocon-harness/actions/runs/41447925424) skipped the browser lane. The two preceding #63 pull-request [runs](https://github.com/Biyocon/biyocon-harness/actions/runs/41438912822) and [runs](https://github.com/Biyocon/biyocon-harness/actions/runs/41431127142) passed it. The same alpha-action timeout predates P2a: [#46 attempt 1](https://github.com/Biyocon/biyocon-harness/actions/runs/40765227756/job/123087541878) failed and attempt 2 passed. [#64 attempt 1](https://github.com/Biyocon/biyocon-harness/actions/runs/41463443031/job/125338041688) and [attempt 2](https://github.com/Biyocon/biyocon-harness/actions/runs/41463443031/job/125352155944) both failed at that click; their keyless session snapshots passed before the browser lane.

## Local test controls

Both commit comparisons used the same isolated worktree setup, sequential runs, an isolated `DSH_HOME` for each run, and a free-port check before and after every run. The test scaffold normally chooses port `0`; an identical **temporary test-harness-only** override set it to `3090` on both worktrees. Its fixture hydrator inserts an unescaped Windows `cwd` into JSONL; an identical temporary JSON-escape override was required to reach the browser test on Windows. The first master run failed during fixture parsing and was excluded from the 11 valid runs. Neither override changed the committed product code or entered this PR. No test used the app on port `10822`.

The comparison command was `pnpm.cmd exec vitest run --config vitest.web.config.ts apps/web/tests/workspace-management.e2e.ts` with `DSH_SNAPSHOT=replay`. The scaffold itself creates separate temporary workspace, persistence, and `DSH_HOME` roots for each run.

## Deterministic reproduction on master

A temporary test probe on `739d18bf` held the host `session.create` response for `beta-ws` while the test hovered alpha's action button. At that point the button was visible and alpha's row began at `y=200`. Releasing the response selected beta's blank session and inserted its `New Session` row above alpha; alpha moved to `y=234`, and its action button became invisible. The probe failed before any #57 fix, with the measured 34 px movement. The first #64 CI log likewise named a `New Session` element as the pointer interceptor before the alpha action disappeared.

The creation helper waits for Workspace registration and its title, while selecting the new Workspace starts blank-session connection asynchronously. The next test can therefore hover alpha before beta's `New Session` row is rendered. Inserting that row moves alpha away from the pointer, so its hover-only action disappears between visibility checking and clicking. This timing is reproducible on master and is not introduced by P2a.

## Repair and verification

`addNewFolderWorkspace` now waits for the selected blank `New Session` row inside the newly created Workspace's group before it returns. The row is the browser-visible completion of the asynchronous selection that can otherwise move adjacent controls. `clickHoverAction` performs one real hover and one real click after that readiness point; its former re-hover polling loop is removed. The regression holds beta's real host `session.create` response after registration and asserts that the creation helper remains pending until the response is released and the selected row appears. The same assertion fails on the pre-fix helper. No timeout is increased, and no action retry, skip, or quarantine is added.

Before the fix, the deterministic regression failed on the creation helper's premature return (`expected true to be false`). After the fix, two focused runs passed, including the real hover and Rename click on alpha. The complete file then passed 31/31 sequential runs; after bounding the regression's signal waits and guaranteeing spy restoration, it passed another 6/6 runs. One final complete-file run passed after the lint-only test edits, for 38/38 complete-file runs after the synchronization fix. Every repetition used port `3090`, a separate `DSH_HOME`, and the same temporary Windows fixture JSON-escape override. `doc-sync` passed all 28 gates using a temporary pnpm JavaScript bridge in `%TEMP%` to avoid this host's `pnpm.exe` runner error. Translation pairing, `lint:contracts-ready`, and `git diff --check` also passed.
