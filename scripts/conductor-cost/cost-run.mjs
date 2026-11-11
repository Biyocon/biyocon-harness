/** Local real-model measurement driver; captures only the public synthetic experiment. */
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises'
import { join, dirname, resolve, relative, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'

const manifest = JSON.parse(await readFile(process.argv[2], 'utf8'))
const { tree, stateRoot, workspace, expectedHead, task, caseId } = manifest
const git = (...args) => execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8' }).trim()
if (git('rev-parse', 'HEAD') !== expectedHead || git('status', '--porcelain')) throw new Error('Runtime tree is not clean at its pinned head')
if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY is absent from the inherited process environment')
const ownedRoots = [await realpath(workspace), await realpath(stateRoot)]
if (resolve(process.cwd()) !== resolve(workspace)) throw new Error('Working directory differs from the experiment workspace')
const load = path => import(pathToFileURL(join(tree, path)).href)
const { boot, installFailLoud } = await load('packages/boot/app-boot/lib/index.js')
const { createUserMessage } = await load('packages/llm/llm/lib/index.js')
const { SessionId } = await load('packages/core/session/lib/index.js')
const { setSandboxMode } = await load('packages/sandbox/sandbox-policy/lib/index.js')
const { setApprovalPolicy } = await load('packages/interaction/user-approval/lib/index.js')
const { DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot } = await load('packages/util/launch-environment/lib/index.js')
const configPath = join(tree, 'examples/headless-agent/.playwright-mcp/conductor-cost.yml')
await mkdir(dirname(configPath), { recursive: true })
const config = `- id: sandbox
  name: '@deepseek-ai/dsh-sandbox-local'
- id: attachments
  name: '@deepseek-ai/dsh-attachment-local'
- id: base
  name: '@deepseek-ai/cordis-plugin-include'
  config:
    path: ../cordis.yml
    patches:
      - id: llm-deepseek
        config:
          baseURL: https://api.deepseek.com
          thinking: enabled
          reasoningEffort: high
          models:
            - id: deepseek-flash
              contextWindow: 1000000
          retryPolicy:
            mode: normal
            maxRetries: 0
      - id: agent-spine
        config:
          agents: []
          workspaceContext: false
          skills:
            filesystem:
              agentsHome: ${JSON.stringify(join(stateRoot, 'agents'))}
          persona: Read-only analysis of public synthetic sources.
      - id: persistence
        config:
          root: ${JSON.stringify(join(stateRoot, 'sessions'))}
          compression: zstd
- id: agent-presets
  name: '@deepseek-ai/dsh-agent-presets'
  config:
    default: conductor
    includeUserRoot: false
    roots:
      - path: ${JSON.stringify(join(tree, 'apps/cli/config/agent-presets'))}
        trust: system
`
await writeFile(configPath, config)
const rawRequests = []
const sessionRefs = new Map()
const seenToolResults = new Map()
const stopped = { reason: null }
const iso = () => new Date().toISOString()
const hash = value => createHash('sha256').update(value).digest('hex')
const driverSha256 = hash(await readFile(new URL(import.meta.url)))
const worlds = JSON.parse(await readFile(join(stateRoot, '..', 'worlds.json'), 'utf8'))
const world = worlds.find(value => value.caseId === caseId)
if (world?.worldManifestHash !== manifest.worldManifestHash) throw new Error('Wrong synthetic world manifest')
async function sourceIntegrity() {
  for (const file of world.files) {
    if (isAbsolute(file.path) || file.path.split(/[\\/]/).includes('..')) throw new Error('Unsafe synthetic file selector')
    if (hash(await readFile(join(workspace, file.path))) !== file.sha256) return false
  }
  return true
}
if (!await sourceIntegrity()) throw new Error('Synthetic source differs from its independent oracle')
if (!manifest.prepareOnly) await writeFile(join(stateRoot, 'started.json'), JSON.stringify({ startedAt: new Date().toISOString(), driverSha256 }), { flag: 'wx' })
const priceNanos = usage => usage === null || usage.cacheReadTokens === undefined ? null
  : usage.inputTokens * 150 + usage.cacheReadTokens * 3 + usage.outputTokens * 600
let ctx, parent, timer, artifactSaved = false
let phase = 'boot'
const startedAt = iso()
const uninstall = installFailLoud('conductor-cost-measurement')
function stop(reason) {
  if (stopped.reason !== null) return
  stopped.reason = reason
  parent?.cancel({ kind: 'hook', reason: `external measurement stop: ${reason}` })
}
try {
  ctx = await boot('conductor-cost-measurement', configPath, undefined, (runtime) => {
    runtime.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([
      { source: 'process', values: Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== undefined)) },
    ]))
  }, pathToFileURL(join(tree, 'examples/')).href)
  ctx.on('session/event', session => { sessionRefs.set(session.id, session) })
  ctx.tools.guard((exec) => {
    const field = ['read', 'read_image'].includes(exec.name) ? 'file_path' : ['glob', 'grep'].includes(exec.name) ? 'path' : undefined
    if (field === undefined) return undefined
    const path = exec.arguments?.[field]
    if (path !== undefined && typeof path !== 'string') return 'Measurement filesystem path must be text.'
    const target = resolve(workspace, path ?? '.')
    return ownedRoots.some(root => { const suffix = relative(root, target); return suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..' + (process.platform === 'win32' ? '\\' : '/'))) })
      ? undefined : 'This measurement reads only its public workspace and fresh private state.'
  })
  ctx.on('llm/stream', (options, next) => {
    const request = JSON.parse(JSON.stringify({ system: options.system, messages: options.messages, tools: options.tools }))
    const seen = seenToolResults.get(options.sessionId) ?? new Set()
    const current = new Set()
    let toolResultChars = 0, repeatedToolResultChars = 0
    for (const message of options.messages) for (const block of message.content) {
      if (block.type !== 'tool-result') continue
      const value = JSON.stringify(block)
      const key = hash(value)
      toolResultChars += Array.from(value).length
      if (seen.has(key)) repeatedToolResultChars += Array.from(value).length
      current.add(key)
    }
    for (const key of current) seen.add(key)
    seenToolResults.set(options.sessionId, seen)
    const step = sessionRefs.get(options.sessionId)?.events.findLast(event => event.type === 'step/start')?.data
    const row = { sequence: rawRequests.length + 1, sessionId: options.sessionId ?? null, turn: step?.turn ?? null, step: step?.step ?? null,
      purpose: options.purpose ?? 'conversation',
      provider: options.provider, model: options.model, reasoningEffort: options.reasoningEffort ?? null,
      issuedAt: iso(), finishedAt: null, finish: null, usage: null,
      systemChars: Array.from(options.system ?? '').length, historyChars: Array.from(JSON.stringify(options.messages)).length,
      toolResultChars, repeatedToolResultChars, request }
    rawRequests.push(row)
    if (rawRequests.length > manifest.maxCalls) stop('model-call-limit')
    return (async function* () {
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'usage') row.usage = { ...chunk.usage }
          if (chunk.type === 'finish') row.finish = chunk.reason.kind
          yield chunk
          const known = rawRequests.reduce((total, entry) => total + (priceNanos(entry.usage) ?? 0), 0)
          if (known > manifest.maxUSD * 1e9) stop('observed-price-limit')
        }
      } finally {
        row.finishedAt = iso()
        if (priceNanos(row.usage) === null) stop('unpriced-or-unknown-model-usage')
      }
    })()
  })
  const created = await ctx.agents.create({ sessionId: SessionId('public-cost-parent'),
    meta: { cwd: workspace, agentPreset: 'conductor' },
    agentOptions: { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' },
    setup: agentCtx => ctx.agentPresets.mount(agentCtx, 'conductor').then(() => undefined) })
  parent = created.agent
  await parent.whenIdle()
  setSandboxMode(parent.session, 'read-only')
  setApprovalPolicy(parent.session, 'never')
  if (!manifest.prepareOnly) {
    phase = 'model'
    timer = setTimeout(() => stop('wall-clock-limit'), manifest.maxMs)
    parent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: task }] }))
    await parent.whenIdle()
  }
  clearTimeout(timer)
  await ctx.sessions.flush(parent.session)
  const sessions = [...sessionRefs.values()].map(session => ({ header: session.header, events: session.events }))
  const checkpoint = parent.session.events.findLast(event => event.type === 'conductor/checkpoint')
  const run = checkpoint?.data.record === undefined || checkpoint.data.record === null ? null : JSON.parse(checkpoint.data.record)
  const roles = new Map(parent.session.events.filter(event => event.type === 'conductor/child').map(event => [event.data.childId, event.data.role]))
  const raw = { manifest, driverSha256, startedAt, endedAt: iso(), config, requests: rawRequests, sessions, run, stopped }
  await writeFile(join(stateRoot, 'raw.json'), JSON.stringify(raw))
  const summary = { caseId, treeHead: expectedHead, driverSha256, prepareOnly: !!manifest.prepareOnly, startedAt, endedAt: raw.endedAt,
    status: run?.status ?? 'not-started', decision: run?.reportDecision?.decision ?? null, stopped: stopped.reason,
    requestCount: rawRequests.length, missingUsage: rawRequests.filter(row => row.usage === null).length,
    unpricedRequests: rawRequests.filter(row => priceNanos(row.usage) === null).length,
    offPeakEquivalentUSD: rawRequests.every(row => priceNanos(row.usage) !== null)
      ? rawRequests.reduce((sum, row) => sum + priceNanos(row.usage), 0) / 1e9 : null,
    calls: rawRequests.map(({ request, ...row }) => ({ ...row, role: row.sessionId === parent.session.id ? 'parent' : roles.get(row.sessionId) ?? 'auxiliary/unknown' })),
    gateCounts: run?.history.map(gate => ({ gate: gate.gate, kind: gate.kind, decision: gate.decision })) ?? [],
    candidate: run?.reportCandidates.at(-1)?.candidate ?? null,
    worldManifestHash: manifest.worldManifestHash,
    sourceFilesUnchanged: await sourceIntegrity(),
  }
  await writeFile(join(stateRoot, 'summary.json'), JSON.stringify(summary, null, 2) + '\n')
  artifactSaved = true
  process.stdout.write(JSON.stringify({ ...summary, calls: summary.calls.length, candidate: undefined }) + '\n')
} catch (error) {
  await writeFile(join(stateRoot, 'failure.json'), JSON.stringify({ phase, name: error?.name, code: error?.code,
    detail: phase === 'boot' ? error?.message : 'Model-stage failure; inspect the isolated session logs.' }))
  process.stderr.write(JSON.stringify({ phase, name: error?.name, code: error?.code }) + '\n')
  process.exitCode = 1
} finally {
  clearTimeout(timer)
  await ctx?.fiber.dispose()
  if (!artifactSaved && ctx !== undefined) await writeFile(join(stateRoot, 'raw-incomplete.json'), JSON.stringify({
    manifest, driverSha256, startedAt, endedAt: iso(), requests: rawRequests,
    sessions: [...sessionRefs.values()].map(session => ({ header: session.header, events: session.events })), stopped,
  }))
  uninstall()
}
