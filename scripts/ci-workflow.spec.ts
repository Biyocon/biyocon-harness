import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '..')
const runnerPrivatePnpmDestination = '${{ runner.temp }}/setup-pnpm'
const trustedPullRequestHead = 'github.event.pull_request.head.repo && toJSON(github.event.pull_request.head.repo.id) == github.repository_id && toJSON(github.event.pull_request.head.repo.owner.id) == github.repository_owner_id && toJSON(github.event.pull_request.head.repo.fork) == \'false\''
const publicForkLinuxRunnerSelector = actionExpression(`${trustedPullRequestHead} && (vars.DSH_CI_FAILOVER_LINUX == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && fromJSON('["self-hosted", "linux", "x64", "vm-backup"]') || 'dsh-ubuntu-24-04-16core') || 'ubuntu-24.04'`)
const publicForkAggregateRunnerSelector = actionExpression(`${trustedPullRequestHead} && (vars.DSH_CI_FAILOVER_LINUX == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && fromJSON('["self-hosted", "linux", "x64", "vm-backup"]') || 'ubuntu-latest') || 'ubuntu-24.04'`)
const publicForkWindowsRunnerSelector = actionExpression(`${trustedPullRequestHead} && (vars.DSH_CI_FAILOVER_WINDOWS == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && fromJSON('["self-hosted", "dsh-win-ci", "windows"]') || 'dsh-windows-2025-16core') || 'windows-2025'`)
const trustedGateConcurrency = actionExpression(`${trustedPullRequestHead} && '8' || '2'`)
const hostedLinuxSetup = actionExpression(`!(${trustedPullRequestHead}) || vars.DSH_CI_FAILOVER_LINUX != 'selfhosted' || github.event.pull_request.user.login == 'dependabot[bot]'`)
const selfHostedLinuxSetup = actionExpression(`${trustedPullRequestHead} && vars.DSH_CI_FAILOVER_LINUX == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]'`)

describe('CI workflow', () => {
  it('routes only an explicitly trusted pull request head beyond hosted runners', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const workflowText = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
    const node24 = workflowJob(workflow, 'node-24')
    const consumers = workflowJob(workflow, 'node-24-consumers')
    const windowsNative = workflowJob(workflow, 'windows-native')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!isRecord(node24.env) || !Array.isArray(consumers.steps)) {
      throw new TypeError('CI workflow must define node-24 env and node-24-consumers steps')
    }
    const consumerSteps: unknown[] = consumers.steps
    const hostedPlaywright: unknown = consumerSteps.find(step => isRecord(step) && step.name === 'Install Playwright Chromium and hosted dependencies')
    const selfHostedPlaywright: unknown = consumerSteps.find(step => isRecord(step) && step.name === 'Install Playwright Chromium on the failover VM')
    if (!isRecord(hostedPlaywright) || !isRecord(selfHostedPlaywright)) {
      throw new TypeError('consumer job must define both Playwright setup steps')
    }

    const trustedRepository = { id: 101, owner: { id: 202 }, fork: false }
    const cases: Array<{ name: string; repo?: unknown; trusted: boolean }> = [
      { name: 'trusted same-repository non-fork', repo: trustedRepository, trusted: true },
      { name: 'external fork', repo: { id: 303, owner: { id: 404 }, fork: true }, trusted: false },
      { name: 'same-repository public fork', repo: { ...trustedRepository, fork: true }, trusted: false },
      { name: 'missing head repository', trusted: false },
      { name: 'null head repository', repo: null, trusted: false },
      { name: 'empty head repository', repo: {}, trusted: false },
      { name: 'string head repository', repo: 'repository', trusted: false },
      { name: 'missing fork flag', repo: { id: 101, owner: { id: 202 } }, trusted: false },
      { name: 'null fork flag', repo: { id: 101, owner: { id: 202 }, fork: null }, trusted: false },
      { name: 'empty fork flag', repo: { id: 101, owner: { id: 202 }, fork: '' }, trusted: false },
      { name: 'string false fork flag', repo: { id: 101, owner: { id: 202 }, fork: 'false' }, trusted: false },
      { name: 'numeric zero fork flag', repo: { id: 101, owner: { id: 202 }, fork: 0 }, trusted: false },
      { name: 'string repository id', repo: { id: '101', owner: { id: 202 }, fork: false }, trusted: false },
      { name: 'wrong repository id', repo: { id: 303, owner: { id: 202 }, fork: false }, trusted: false },
      { name: 'wrong owner id', repo: { id: 101, owner: { id: 404 }, fork: false }, trusted: false },
      { name: 'missing owner', repo: { id: 101, fork: false }, trusted: false },
    ]

    for (const testCase of cases) {
      const context: PullRequestRouteContext = {
        event: { pull_request: { head: testCase.repo === undefined ? {} : { repo: testCase.repo }, user: { login: 'contributor' } } },
        repositoryId: '101',
        repositoryOwnerId: '202',
        linuxFailover: 'selfhosted',
        windowsFailover: 'selfhosted',
      }
      expect(() => evaluateTrustedHead(context), testCase.name).not.toThrow()
      expect(evaluateTrustedHead(context), testCase.name).toBe(testCase.trusted)
      expect(evaluateRunnerSelector(node24['runs-on'], publicForkLinuxRunnerSelector, context), testCase.name)
        .toEqual(testCase.trusted ? ['self-hosted', 'linux', 'x64', 'vm-backup'] : 'ubuntu-24.04')
      expect(evaluateRunnerSelector(windowsNative['runs-on'], publicForkWindowsRunnerSelector, context), testCase.name)
        .toEqual(testCase.trusted ? ['self-hosted', 'dsh-win-ci', 'windows'] : 'windows-2025')
      expect(evaluateRunnerSelector(aggregate['runs-on'], publicForkAggregateRunnerSelector, context), testCase.name)
        .toEqual(testCase.trusted ? ['self-hosted', 'linux', 'x64', 'vm-backup'] : 'ubuntu-24.04')
      expect(evaluateTrustedValue(node24.env.DSH_GATE_CONCURRENCY, trustedGateConcurrency, context, '8', '2'), testCase.name)
        .toBe(testCase.trusted ? '8' : '2')
      expect(evaluateHostedSetup(hostedPlaywright.if, hostedLinuxSetup, context), testCase.name).toBe(!testCase.trusted)
      expect(evaluateSelfHostedSetup(selfHostedPlaywright.if, selfHostedLinuxSetup, context), testCase.name).toBe(testCase.trusted)
    }

    const trustedEnterpriseContext: PullRequestRouteContext = {
      event: { pull_request: { head: { repo: trustedRepository }, user: { login: 'contributor' } } },
      repositoryId: '101',
      repositoryOwnerId: '202',
      linuxFailover: '',
      windowsFailover: '',
    }
    expect(evaluateRunnerSelector(node24['runs-on'], publicForkLinuxRunnerSelector, trustedEnterpriseContext))
      .toBe('dsh-ubuntu-24-04-16core')
    expect(evaluateRunnerSelector(windowsNative['runs-on'], publicForkWindowsRunnerSelector, trustedEnterpriseContext))
      .toBe('dsh-windows-2025-16core')

    const pullRequestExpressions = collectStrings(workflow)
      .filter(value => value.includes('github.event.pull_request.head.repo'))
    expect(pullRequestExpressions).toHaveLength(21)
    for (const expression of pullRequestExpressions) {
      expect(expression.replace(/\s+/g, ' ')).toContain(trustedPullRequestHead)
    }
    expect(workflowText.match(/github\.event\.repository\.fork/g)).toHaveLength(4)
  })

  it('isolates every pnpm action setup destination per runner', () => {
    const workflow: unknown = yaml.load(readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8'))
    if (!isRecord(workflow) || !isRecord(workflow.jobs)) throw new TypeError('CI workflow must define jobs')

    const setups = Object.entries(workflow.jobs).flatMap(([jobName, job]) => {
      if (!isRecord(job) || !Array.isArray(job.steps)) return []
      return job.steps.flatMap((step) => {
        if (!isRecord(step) || typeof step.uses !== 'string' || !step.uses.startsWith('pnpm/action-setup@')) return []
        return [{ jobName, step }]
      })
    })

    expect(setups.length).toBeGreaterThan(0)
    for (const { jobName, step } of setups) {
      expect(step, `${jobName} must not share pnpm/action-setup's default destination`).toMatchObject({
        with: { dest: runnerPrivatePnpmDestination },
      })
    }
  })

  it('keeps a required Wine Windows job, a non-blocking native Windows job with failover, and a master-only standby', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.jobs)
      || !isRecord(workflow.jobs.windows)
      || !isRecord(workflow.jobs['windows-native'])
      || !isRecord(workflow.jobs['wine-apt-cache'])
      || !isRecord(workflow.jobs['serial-windows'])
      || !isRecord(workflow.jobs['node-24'])
      || !isRecord(workflow.jobs['node-24-coverage'])
      || !isRecord(workflow.jobs['node-24-consumers'])
      || !isRecord(workflow.jobs['all-checks-passed'])) {
      throw new TypeError('CI workflow must define windows, windows-native, wine-apt-cache, serial-windows, node-24, node-24-coverage, node-24-consumers, and all-checks-passed jobs')
    }

    const windows = workflow.jobs.windows
    const windowsNative = workflow.jobs['windows-native']
    const wineAptCache = workflow.jobs['wine-apt-cache']
    const serialWindows = workflow.jobs['serial-windows']
    const node24 = workflow.jobs['node-24']
    const node24Coverage = workflow.jobs['node-24-coverage']
    const node24Consumers = workflow.jobs['node-24-consumers']
    const aggregate = workflow.jobs['all-checks-passed']
    if (!Array.isArray(windows.steps) || !Array.isArray(aggregate.needs)) {
      throw new TypeError('Windows job must define steps and the aggregate must define needs')
    }
    const commandSteps = windows.steps.filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))

    // Required PR job: Wine on ubuntu-latest, runs wine-windows-gates.sh.
    expect(windows['runs-on']).toBe('ubuntu-latest')
    expect(windows.name).toBe('windows node 24 / wine blocking')
    expect(windows.if).toBe("github.event_name == 'pull_request'")
    expect(commandSteps.some(step => step.run.includes('wine-windows-gates.sh'))).toBe(true)
    expect(windows.needs).toBeUndefined()
    const wineSteps = windows.steps.filter(isRecord)
    expect(wineSteps.find(step => step.uses === './.github/actions/wine-apt')).toMatchObject({
      with: { install: 'true' },
    })
    expect(windows['timeout-minutes']).toBe(15)

    // windows-native: non-blocking native job with failover, runs windows-complete.
    // Its pool is resolved by the Windows-specific switch.
    expect(typeof windowsNative['runs-on']).toBe('string')
    expect(windowsNative['runs-on']).toContain('DSH_CI_FAILOVER_WINDOWS')
    expect(windowsNative['runs-on']).not.toContain('DSH_CI_FAILOVER_LINUX')
    expect(windowsNative['runs-on']).toContain('self-hosted')
    expect(windowsNative['runs-on']).toContain('dsh-win-ci')
    expect(windowsNative['runs-on']).toContain('dsh-windows-2025-16core')
    expectRunnerSelector(windowsNative, publicForkWindowsRunnerSelector)
    expect(windowsNative.name).toBe('windows node 24 / native complete')
    expect(windowsNative.if).toBe("github.event_name == 'pull_request'")
    expect(windowsNative.env).toMatchObject({
      DSH_COVERAGE_MAX_WORKERS: actionExpression(`${trustedPullRequestHead} && '2' || '1'`),
      DSH_COVERAGE_TEST_TIMEOUT_MS: '30000',
      DSH_GATE_CONCURRENCY: actionExpression(`${trustedPullRequestHead} && '2' || '1'`),
      DSH_PUBLINT_CONCURRENCY: trustedGateConcurrency,
    })
    const nativeCommandSteps = (windowsNative.steps as unknown[]).filter((step): step is Record<string, unknown> & { run: string } => (
      isRecord(step) && typeof step.run === 'string'
    ))
    expect(nativeCommandSteps.map(step => step.run)).toContain('pnpm run check:ci:windows-complete')

    // PRs resolve their own image; master seeds only its default-branch scope.
    expect(wineAptCache.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(wineAptCache['runs-on']).toBe('ubuntu-latest')
    expect(wineAptCache['timeout-minutes']).toBe(10)
    const seedSteps = Array.isArray(wineAptCache.steps) ? wineAptCache.steps.filter(isRecord) : []
    expect(seedSteps.some(step => step.uses === './.github/actions/wine-apt')).toBe(true)
    for (const writer of [windows, wineAptCache]) {
      expect(writer.concurrency).toEqual({
        group: 'wine-apt-${{ github.repository }}-${{ github.ref }}',
        'cancel-in-progress': false,
      })
    }
    const action = loadWorkflow('.github/actions/wine-apt/action.yml')
    if (!isRecord(action.runs) || !Array.isArray(action.runs.steps)) throw new TypeError('Wine composite action must define steps')
    const steps = action.runs.steps.filter(isRecord)
    const verifyIndex = steps.findIndex(step => step.name === 'Verify complete Wine archives offline before saving')
    const saveIndex = steps.findIndex(step => step.name === 'Save verified Wine archives')
    const stageIndex = steps.findIndex(step => step.name === 'Stage seed files away before checking cache transport')
    const confirmIndex = steps.findIndex(step => step.name === 'Confirm saved Wine cache is restorable')
    expect(verifyIndex).toBeGreaterThan(0)
    expect(saveIndex).toBeGreaterThan(verifyIndex)
    expect(stageIndex).toBeGreaterThan(saveIndex)
    expect(confirmIndex).toBeGreaterThan(stageIndex)
    expect(steps[verifyIndex]?.if).toBeUndefined()
    expect(steps[saveIndex]).toMatchObject({
      uses: 'actions/cache/save@v4', if: "steps.cache.outputs.cache-hit != 'true'",
    })
    expect(steps[confirmIndex]).toMatchObject({
      uses: 'actions/cache/restore@v4',
      if: "steps.cache.outputs.cache-hit != 'true'",
      with: { 'fail-on-cache-miss': true },
    })
    const cachePaths = '~/wine-debs/*.deb\n~/wine-debs/wine-plan.json\n'
    const cacheSteps = steps.filter(step => typeof step.uses === 'string' && step.uses.startsWith('actions/cache/'))
    expect(cacheSteps).toHaveLength(3)
    for (const step of cacheSteps) expect(step.with).toMatchObject({ path: cachePaths })
    expect(steps.some(step => typeof step.run === 'string' && step.run.includes('wine-apt-cache.integration.mjs'))).toBe(true)
    expect(steps.find(step => step.name === 'Install Wine offline from verified cache')).toMatchObject({ if: "inputs.install == 'true'" })
    const provisioning = readFileSync(resolve(root, 'scripts/wine-apt-cache.sh'), 'utf8')
    expect(provisioning).not.toMatch(/apt-get[^\n]* update/)
    expect(provisioning).toContain('Dir::Cache::archives=$archive_dir')
    expect(provisioning).toContain('unshare --net apt-get')
    expect(provisioning).toContain('--yes --no-download')
    expect(provisioning).toContain('Acquire::Retries=0')

    // serial-windows: master-only standby, self-hosted, non-blocking.
    expect(serialWindows.if).toBe("github.event.repository.fork == false && github.event_name == 'push' && github.ref == 'refs/heads/master'")
    expect(serialWindows['runs-on']).toEqual(['self-hosted', 'dsh-win-ci', 'windows'])
    expect(serialWindows.name).toBe('serial / windows (self-hosted standby)')

    // Aggregate: Wine `windows` required, native `windows-native` excluded.
    expect(aggregate.needs).toContain('windows')
    expect(aggregate.needs).not.toContain('windows-native')
    expect(aggregate.needs).not.toContain('serial-windows')

    // Linux failover is a separate switch: the three required Linux workers
    // and the verdict job resolve their pool through DSH_CI_FAILOVER_LINUX,
    // never the Windows switch.
    for (const [jobName, job] of [['node-24', node24], ['node-24-coverage', node24Coverage], ['node-24-consumers', node24Consumers]] as const) {
      expect(typeof job['runs-on']).toBe('string')
      expect(job['runs-on'], `${jobName} runs-on must use the Linux failover switch`).toContain('DSH_CI_FAILOVER_LINUX')
      expect(job['runs-on'], `${jobName} runs-on must not use the Windows failover switch`).not.toContain('DSH_CI_FAILOVER_WINDOWS')
      expect(job['runs-on']).toContain('vm-backup')
      expectRunnerSelector(job, publicForkLinuxRunnerSelector)
    }
    expect(node24.env).toMatchObject({
      DSH_GATE_CONCURRENCY: trustedGateConcurrency,
    })
    expect(node24Coverage.env).toMatchObject({
      DSH_COVERAGE_MAX_WORKERS: actionExpression(`${trustedPullRequestHead} && (vars.DSH_CI_FAILOVER_LINUX == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '8' || '6') || '2'`),
      DSH_GATE_CONCURRENCY: actionExpression(`${trustedPullRequestHead} && '3' || '1'`),
    })
    expect(node24Consumers.env).toMatchObject({
      DSH_GATE_CONCURRENCY: trustedGateConcurrency,
      DSH_OXLINT_THREADS: trustedGateConcurrency,
      DSH_PUBLINT_CONCURRENCY: trustedGateConcurrency,
      DSH_SNAPSHOT_MAX_CONCURRENCY: actionExpression(`${trustedPullRequestHead} && (vars.DSH_CI_FAILOVER_LINUX == 'selfhosted' && github.event.pull_request.user.login != 'dependabot[bot]' && '12' || '32') || '4'`),
    })
    const consumerSteps = Array.isArray(node24Consumers.steps) ? node24Consumers.steps.filter(isRecord) : []
    const hostedPlaywright = consumerSteps.find(step => step.name === 'Install Playwright Chromium and hosted dependencies')
    const selfHostedPlaywright = consumerSteps.find(step => step.name === 'Install Playwright Chromium on the failover VM')
    expect(hostedPlaywright?.if).toBe(hostedLinuxSetup)
    expect(selfHostedPlaywright?.if).toBe(selfHostedLinuxSetup)
    expect(aggregate['runs-on']).toContain('DSH_CI_FAILOVER_LINUX')
    expect(aggregate['runs-on']).not.toContain('DSH_CI_FAILOVER_WINDOWS')
    expect(aggregate['runs-on']).toContain('vm-backup')
    expectRunnerSelector(aggregate, publicForkAggregateRunnerSelector)
  })

  it('exempts push from cancellation, so one master merge does not cancel the running drill', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    if (!isRecord(workflow.jobs) || !isRecord(workflow.concurrency)) {
      throw new TypeError('CI workflow must define jobs and a workflow-level concurrency block')
    }

    // Cancellation applies to the whole superseded RUN, so this has to be
    // decided at workflow level and gated on the event: a job-level group
    // cannot exempt its job from its run being cancelled. Only push is exempt —
    // a drill takes longer than the interval between master merges. The negated
    // form is load-bearing: `== 'pull_request'` would also stop cancelling
    // workflow_dispatch, and a re-dispatched runner benchmark holds up to 12
    // larger runners for 15 minutes in this same group on master. The
    // expression is evaluated against the NEWLY TRIGGERED run, so a dispatch on
    // master still cancels a mid-flight drill; the runbook records that bound.
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name != 'push' }}")

    // Neither drill may carry a job-level group: it would not exempt the job
    // from run-scoped cancellation.
    for (const name of ['serial-linux-selfhosted', 'serial-windows']) {
      const job = workflow.jobs[name]
      if (!isRecord(job)) throw new TypeError(`${name} must be defined`)
      expect(job.concurrency).toBeUndefined()
      // Both stay master-push-only; that is what makes the push carve-out safe.
      expect(job.if).toBe("github.event.repository.fork == false && github.event_name == 'push' && github.ref == 'refs/heads/master'")
    }

    // What bounds the cost of exempting push: a master push may only carry the
    // cache seeder and the two drills. Any job reachable on push would start
    // accumulating uncancelled runs, so the set is pinned here.
    //
    // Classification is an exact allowlist of the conditions in use, not a
    // substring match: `github.event_name != 'pull_request'` mentions
    // `pull_request` yet IS push-reachable, so matching on the event name alone
    // would silently misclassify it as gated.
    const NOT_PUSH_REACHABLE = new Set([
      "github.event_name == 'pull_request'",
      "always() && github.event_name == 'pull_request'",
      "github.event.repository.fork == false && github.event_name == 'workflow_dispatch' && inputs.suite == 'larger-runner-benchmark'",
      "github.event.repository.fork == false && github.event_name == 'workflow_dispatch' && inputs.suite == 'consolidated-runner-benchmark'",
    ])
    const pushReachable = Object.entries(workflow.jobs)
      .filter(([, job]) => {
        if (!isRecord(job)) return false
        if (job.if === undefined) return true // unconditional: runs on every event
        if (job.if === false) return false // `if: false` parses as a boolean
        if (typeof job.if !== 'string') return true // unrecognized shape: surface it
        return !NOT_PUSH_REACHABLE.has(job.if.trim())
      })
      .map(([name]) => name)
      .sort()
    expect(pushReachable).toEqual(['serial-linux-selfhosted', 'serial-windows', 'wine-apt-cache'])

    // Why workflow_dispatch must keep cancelling: each benchmark fans out to a
    // dozen larger runners at once, in this same group on master. If it stopped
    // cancelling, a re-dispatch would queue ahead of a drill instead of
    // replacing the stale measurement.
    for (const name of ['larger-runner-benchmark', 'consolidated-runner-benchmark']) {
      const job = workflow.jobs[name]
      if (!isRecord(job) || !isRecord(job.strategy)) {
        throw new TypeError(`${name} must define a matrix strategy`)
      }
      expect(job.strategy['max-parallel']).toBe(12)
      expect(job['timeout-minutes']).toBe(15)
      expect(job.if).toContain('github.event.repository.fork == false')
    }
  })

  it('keeps supported LSP source under native Windows coverage', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain('packages/lsp/lsp-stdio/src/connection.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/index.ts')
    expect(config).not.toContain('packages/lsp/lsp-stdio/src/instance.ts')
  })

  it('requires one release-shaped Python runtime target on every pull request', () => {
    const workflow = loadWorkflow('.github/workflows/ci.yml')
    const pythonRuntime = workflowJob(workflow, 'python-runtime')
    const aggregate = workflowJob(workflow, 'all-checks-passed')
    if (!Array.isArray(aggregate.needs)) {
      throw new TypeError('CI aggregate must define required job dependencies')
    }

    expect(pythonRuntime).toMatchObject({
      if: "github.event_name == 'pull_request'",
      name: 'python runtime / release-shaped Linux x64',
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64',
        ci: true,
      },
    })
    expect(aggregate.needs).toContain('python-runtime')
  })

  it('keeps every Vitest project process-isolated on native Windows', () => {
    const config = readFileSync(resolve(root, 'vitest.config.ts'), 'utf8')

    expect(config).not.toContain("pool: process.platform === 'win32' ? 'threads' : 'forks'")
    expect(config.match(/pool: 'forks'/g)).toHaveLength(2)
  })
})

describe('E2B e2e workflow', () => {
  it('is manual-only and fails loud before running the focused live suite', () => {
    const workflow = loadWorkflow('.github/workflows/e2b-e2e.yml')
    expect(workflow.on).toEqual({ workflow_dispatch: null })
    if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs.e2b) || !Array.isArray(workflow.jobs.e2b.steps)) {
      throw new TypeError('E2B e2e workflow must define the e2b job steps')
    }

    const steps = workflow.jobs.e2b.steps.filter(isRecord)
    const preflight = steps.find(step => step.name === 'Preflight (require E2B API key)')
    const e2b = steps.find(step => step.name === 'E2B tests (live sandbox)')

    expect(preflight).toMatchObject({
      env: { E2B_API_KEY: '${{ secrets.E2B_API_KEY_EXTERNAL }}' },
    })
    expect(preflight?.run).toContain('E2B_API_KEY_EXTERNAL repository secret')
    expect(e2b).toMatchObject({
      env: {
        E2B_API_KEY: '${{ secrets.E2B_API_KEY_EXTERNAL }}',
        DSH_E2E_MAX_WORKERS: '1',
        DSH_EXAMPLE_MODE: 'lib',
      },
    })
    expect(e2b?.run).toContain('packages/e2b/e2b/tests/composition.e2e.ts')
  })
})

describe('Python release workflows', () => {
  it('keeps complete wheel validation separate from protected public publication', () => {
    const workflow = loadWorkflow('.github/workflows/python-release.yml')
    const dispatch = workflowEvent(workflow, 'workflow_dispatch')
    const pullRequest = workflowEvent(workflow, 'pull_request')
    const build = workflowJob(workflow, 'build')
    const pythonCompat = workflowJob(workflow, 'python-compat')
    const validate = workflowJob(workflow, 'validate')
    const publishRuntime = workflowJob(workflow, 'publish-runtime')
    const publishSdk = workflowJob(workflow, 'publish-sdk')
    if (!isRecord(dispatch.inputs)
      || !isRecord(dispatch.inputs.publish)
      || !Array.isArray(pythonCompat.steps)
      || !Array.isArray(validate.steps)
      || !Array.isArray(publishRuntime.steps)
      || !Array.isArray(publishSdk.steps)) {
      throw new TypeError('Python release workflow must define publish input and release steps')
    }

    expect(dispatch.inputs.publish).toMatchObject({ type: 'boolean', default: false })
    expect(pullRequest).toEqual({ types: ['labeled'] })
    expect(build).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' || github.event.label.name == 'python-release-dry-run'",
      uses: './.github/workflows/build-exe-for-python-sdk.yml',
      with: {
        targets: 'node24-linux-x64,node24-linux-arm64,node24-macos-arm64',
        release: true,
      },
    })
    expect(pythonCompat.strategy).toMatchObject({ matrix: { python: ['3.10', '3.14'] } })
    expect(JSON.stringify(pythonCompat.steps)).toContain('deepseek-harness-sdk==${{ steps.compatibility-version.outputs.version }}')
    const validateSteps = JSON.stringify(validate.steps)
    const authorize = validate.steps.filter(isRecord).find(step => step.name === 'Authorize publication request')
    if (!isRecord(authorize) || typeof authorize.run !== 'string') {
      throw new TypeError('Python release validation must authorize publication requests')
    }
    expect(validateSteps).toContain('PUBLIC_PYPI_RELEASE_ENABLED')
    expect(authorize).toMatchObject({
      env: {
        PYPI_PUBLISHER_REPOSITORY: '${{ vars.PYPI_PUBLISHER_REPOSITORY }}',
        REPOSITORY: '${{ github.repository }}',
      },
    })
    expect(authorize.run).toContain('[ "$REPOSITORY" = "$PYPI_PUBLISHER_REPOSITORY" ]')
    expect(validateSteps).toContain('100000000')
    expect(publishRuntime).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: 'validate',
      environment: 'pypi-runtime',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    expect(publishSdk).toMatchObject({
      if: "github.event_name == 'workflow_dispatch' && inputs.publish",
      needs: ['validate', 'publish-runtime'],
      environment: 'pypi',
      permissions: { contents: 'read', 'id-token': 'write' },
    })
    const runtimeSteps = publishRuntime.steps.filter(isRecord)
    const sdkSteps = publishSdk.steps.filter(isRecord)
    const runtimePublish = runtimeSteps.find(step => step.name === 'Publish runtime wheels')
    const sdkPublish = sdkSteps.find(step => step.name === 'Publish SDK wheel')
    const runtimeHashes = runtimeSteps.find(step => step.name === 'Verify release artifact hashes')
    const sdkHashes = sdkSteps.find(step => step.name === 'Verify release artifact hashes')
    expect([...runtimeSteps, ...sdkSteps].some(
      step => typeof step.uses === 'string' && step.uses.startsWith('actions/checkout@'),
    )).toBe(false)
    expect([...runtimeSteps, ...sdkSteps].filter(
      step => step.uses === 'pypa/gh-action-pypi-publish@release/v1',
    )).toHaveLength(2)
    expect(runtimePublish).toMatchObject({
      with: { 'packages-dir': 'dist/runtime/', attestations: false },
    })
    expect(sdkPublish).toMatchObject({
      with: { 'packages-dir': 'dist/sdk/', attestations: false },
    })
    expect(runtimeHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
    expect(sdkHashes).toMatchObject({ run: 'cd dist && sha256sum -c SHA256SUMS' })
  })

  it('exposes the native wheel builder to the release caller with normalized versions', () => {
    const workflow = loadWorkflow('.github/workflows/build-exe-for-python-sdk.yml')
    const call = workflowEvent(workflow, 'workflow_call')
    const plan = workflowJob(workflow, 'plan')
    const build = workflowJob(workflow, 'build')
    if (!isRecord(call.inputs) || !Array.isArray(plan.steps) || !Array.isArray(build.steps)) {
      throw new TypeError('Python wheel builder must define workflow_call inputs and plan steps')
    }

    const buildSteps: unknown[] = build.steps
    const manylinuxAddon = buildSteps.find(step => isRecord(step) && step.name === 'Rebuild Linux node-pty against manylinux 2.28')
    const macosCheck = buildSteps.find(step => isRecord(step) && step.name === 'Check macOS deployment target')
    const manylinuxSmoke = buildSteps.find(step => isRecord(step) && step.name === 'Run wheel in a manylinux 2.28 container')
    expect(call.inputs).toHaveProperty('targets')
    expect(call.inputs).toMatchObject({
      ci: { type: 'boolean', default: false },
      release: { type: 'boolean', default: false },
    })
    expect(workflow.concurrency).toMatchObject({
      group: 'build-single-exe-${{ github.workflow }}-${{ github.ref }}',
    })
    expect(plan.if).toContain('inputs.ci')
    expect(plan.if).toContain('inputs.release')
    expect(JSON.stringify(plan.steps)).toContain('pep440_version')
    expect(JSON.stringify(workflow)).toContain('macosx_14_0_arm64')
    expect(manylinuxAddon).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_x86_64')
    expect(JSON.stringify(manylinuxAddon)).toContain('manylinux_2_28_aarch64')
    expect(JSON.stringify(manylinuxAddon)).toContain('npm_config_build_from_source=true pnpm run install')
    expect(JSON.stringify(manylinuxAddon)).toContain('$HOME/setup-pnpm:$HOME/setup-pnpm:ro')
    expect(JSON.stringify(manylinuxAddon)).toContain('node-pty-glibc-versions.txt')
    expect(JSON.stringify(manylinuxAddon)).toContain('le 2.28')
    expect(macosCheck).toMatchObject({ if: "runner.os == 'macOS'" })
    expect(JSON.stringify(macosCheck)).toContain('scripts/check-macos-deployment-target.py')
    expect(JSON.stringify(macosCheck)).toContain('$EXE-spawn-helper')
    expect(manylinuxSmoke).toMatchObject({ if: "runner.os == 'Linux'" })
    expect(JSON.stringify(manylinuxSmoke)).toContain('-e DSH_TELEMETRY_DISABLED')
  })

  it('uses the shared macOS deployment-target check in GitLab', () => {
    const workflow = loadWorkflow('.gitlab-ci.yml')
    const runtimeWheel = workflow['.runtime-wheel']
    if (!isRecord(runtimeWheel) || !Array.isArray(runtimeWheel.script)) {
      throw new TypeError('GitLab CI must define the runtime wheel script')
    }
    const runtimeScript: unknown[] = runtimeWheel.script
    const macosCheck = runtimeScript.find(
      step => typeof step === 'string' && step.includes('PLATFORM" = macos-arm64'),
    )
    if (typeof macosCheck !== 'string') {
      throw new TypeError('GitLab CI must check the macOS deployment target')
    }

    expect(macosCheck).toContain('scripts/check-macos-deployment-target.py')
    expect(macosCheck).toContain('"$EXE" "$EXE-spawn-helper"')
  })
})

describe('Issue lifecycle workflow', () => {
  it('uses explicit review handoff events without rerunning when a draft becomes ready', () => {
    const lifecycle = loadWorkflow('.github/workflows/issue-lifecycle.yml')
    const lifecyclePullRequest = workflowEvent(lifecycle, 'pull_request')
    const lifecycleReview = workflowEvent(lifecycle, 'pull_request_review')
    const lifecycleJob = workflowJob(lifecycle, 'lifecycle')
    const policy = loadWorkflow('.github/workflows/issue-policy.yml')
    const policyPullRequest = workflowEvent(policy, 'pull_request')

    expect(lifecyclePullRequest.types).not.toContain('ready_for_review')
    expect(lifecyclePullRequest.types).toContain('review_requested')
    expect(lifecycleReview.types).toEqual(['submitted'])
    expect(lifecycleJob.if).toBe(
      "${{ github.event_name != 'pull_request_review' || (github.event.action == 'submitted' && github.event.review.state == 'changes_requested') }}",
    )
    expect(policyPullRequest.types).toContain('ready_for_review')
  })
})

describe('Git hooks', () => {
  it('leaves frozen Agent Note sidecars to the archive verifier', () => {
    const lefthook = loadWorkflow('lefthook.yml')

    for (const hookName of ['pre-commit', 'pre-merge-commit']) {
      const hook = lefthook[hookName]
      if (!isRecord(hook) || !Array.isArray(hook.jobs)) {
        throw new TypeError(`lefthook must define ${hookName} jobs`)
      }
      const pairing: unknown = hook.jobs.find(
        (job: unknown) => isRecord(job) && job.name === 'translation pairing (staged records)',
      )

      expect(pairing).toMatchObject({ exclude: ['.agents/notes/archived/**'] })
    }
  })
})

function loadWorkflow(path: string): Record<string, unknown> {
  const workflow: unknown = yaml.load(readFileSync(resolve(root, path), 'utf8'))
  if (!isRecord(workflow)) throw new TypeError(`${path} must define a workflow`)
  return workflow
}

function workflowEvent(workflow: Record<string, unknown>, event: string): Record<string, unknown> {
  if (!isRecord(workflow.on) || !isRecord(workflow.on[event])) {
    throw new TypeError(`workflow must define the ${event} event`)
  }
  return workflow.on[event]
}

function workflowJob(workflow: Record<string, unknown>, job: string): Record<string, unknown> {
  if (!isRecord(workflow.jobs) || !isRecord(workflow.jobs[job])) {
    throw new TypeError(`workflow must define the ${job} job`)
  }
  return workflow.jobs[job]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function expectRunnerSelector(job: Record<string, unknown>, expected: string): void {
  const runsOn = job['runs-on']
  if (typeof runsOn !== 'string') throw new TypeError('runner selector must be a string')
  expect(runsOn.replace(/\s+/g, ' ').trim()).toBe(expected)
}

interface PullRequestRouteContext {
  event: unknown
  repositoryId: string
  repositoryOwnerId: string
  linuxFailover: string
  windowsFailover: string
}

function actionExpression(body: string): string {
  return `\${{ ${body} }}`
}

function collectStrings(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap(collectStrings)
  if (!isRecord(value)) return []
  return Object.values(value).flatMap(collectStrings)
}

function evaluateRunnerSelector(
  expression: unknown,
  expected: string,
  context: PullRequestRouteContext,
): string | string[] {
  bindExpression(expression, expected)
  if (!evaluateTrustedHead(context)) {
    return expected === publicForkWindowsRunnerSelector ? 'windows-2025' : 'ubuntu-24.04'
  }

  const login = actionsProperty(context.event, ['pull_request', 'user', 'login'])
  const dependabot = actionsEqual(login, 'dependabot[bot]')
  if (expected === publicForkWindowsRunnerSelector) {
    return context.windowsFailover === 'selfhosted' && !dependabot
      ? ['self-hosted', 'dsh-win-ci', 'windows']
      : 'dsh-windows-2025-16core'
  }
  if (context.linuxFailover === 'selfhosted' && !dependabot) {
    return ['self-hosted', 'linux', 'x64', 'vm-backup']
  }
  return expected === publicForkAggregateRunnerSelector ? 'ubuntu-latest' : 'dsh-ubuntu-24-04-16core'
}

function evaluateTrustedValue<T>(
  expression: unknown,
  expected: string,
  context: PullRequestRouteContext,
  trusted: T,
  hosted: T,
): T {
  bindExpression(expression, expected)
  return evaluateTrustedHead(context) ? trusted : hosted
}

function evaluateHostedSetup(expression: unknown, expected: string, context: PullRequestRouteContext): boolean {
  bindExpression(expression, expected)
  const login = actionsProperty(context.event, ['pull_request', 'user', 'login'])
  return !evaluateTrustedHead(context)
    || context.linuxFailover !== 'selfhosted'
    || actionsEqual(login, 'dependabot[bot]')
}

function evaluateSelfHostedSetup(expression: unknown, expected: string, context: PullRequestRouteContext): boolean {
  bindExpression(expression, expected)
  const login = actionsProperty(context.event, ['pull_request', 'user', 'login'])
  return evaluateTrustedHead(context)
    && context.linuxFailover === 'selfhosted'
    && !actionsEqual(login, 'dependabot[bot]')
}

function evaluateTrustedHead(context: PullRequestRouteContext): boolean {
  const repository = actionsProperty(context.event, ['pull_request', 'head', 'repo'])
  return actionsTruthy(repository)
    && actionsEqual(actionsToJson(actionsProperty(repository, ['id'])), context.repositoryId)
    && actionsEqual(actionsToJson(actionsProperty(repository, ['owner', 'id'])), context.repositoryOwnerId)
    && actionsEqual(actionsToJson(actionsProperty(repository, ['fork'])), 'false')
}

function actionsProperty(value: unknown, path: string[]): unknown {
  let current = value
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) return ''
    current = current[key]
  }
  return current
}

function actionsToJson(value: unknown): string {
  return JSON.stringify(value) ?? ''
}

function actionsTruthy(value: unknown): boolean {
  return value !== false
    && value !== null
    && value !== ''
    && value !== 0
    && !(typeof value === 'number' && Number.isNaN(value))
}

function actionsEqual(left: unknown, right: unknown): boolean {
  if (typeof left === typeof right) {
    if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase()
    return left === right
  }
  const leftNumber = Number(left)
  const rightNumber = Number(right)
  return !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber) && leftNumber === rightNumber
}

function bindExpression(actual: unknown, expected: string): void {
  if (typeof actual !== 'string') throw new TypeError('workflow expression must be a string')
  expect(actual.replace(/\s+/g, ' ').trim()).toBe(expected)
}
