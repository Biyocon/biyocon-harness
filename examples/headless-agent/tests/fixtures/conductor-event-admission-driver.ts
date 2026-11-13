/** Exercise required-event admission through real Loader boot and agent resume, without a model. */
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { MessageId, freezeMessage } from '@deepseek-ai/dsh-llm'
import { ConductorRunId, createRun, admitIntake, captureIntakeMaterial, serializeRun,
  SessionConductorRunStore, CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-tools'

const [config, kind, bundle, action] = process.argv.slice(2)
const id = SessionId('synthetic-history')
const runId = ConductorRunId('CON-2026-0037')
const enabled = bundle === 'with-bundle'
const refusal = !enabled && kind !== 'chat'
const patch = fileURLToPath(new URL('../../../../packages/conductor/conductor-host-rc7/cordis.patch.yml', import.meta.url))

async function artifacts(): Promise<Record<string, string>> {
  const root = join(process.cwd(), '.sessions')
  const files = (await readdir(root, { recursive: true })).filter(file => file.endsWith('.jsonl')).sort()
  return Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(join(root, file), 'utf8')] as const)))
}

let ctx: Context | undefined
try {
  assert.ok(config)
  ctx = await boot('conductor-event-admission', config, enabled ? loadOverlayPatches('test', patch) : [])
  for (const type of CONDUCTOR_SESSION_EVENT_TYPES) assert.equal(ctx.sessions.supportsEventType(type), enabled)
  let modelCalls = 0
  let toolCalls = 0
  let published = 0
  ctx.on('agent/request', () => { modelCalls++; throw new Error('unexpected model request during history replay') })
  ctx.on('tools/pre-execute', () => { toolCalls++; throw new Error('unexpected tool execution during history replay') })
  ctx.on('agent/created', () => { published++ })
  if (action === 'seed') {
    const session = Session.create(id, [], { version: 0, id, cwd: process.cwd(), createdAt: 1 })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', freezeMessage({ id: MessageId('synthetic-user'), role: 'user',
      content: [{ type: 'text', text: 'Synthetic earlier question.' }], source: { kind: 'user' } }), { surfaceOp: 'append' })
    session.append('step/start', { turn: 1, step: 1 })
    session.append('assistant/message', { turn: 1, step: 1, message: freezeMessage({
      id: MessageId('synthetic-assistant'), role: 'assistant', content: [{ type: 'text', text: 'Synthetic earlier answer.' }],
      source: { kind: 'model', provider: 'synthetic', model: 'synthetic' },
    }) }, { surfaceOp: 'append' })
    session.append('step/end', { turn: 1, step: 1 })
    session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    if (kind !== 'chat') {
      const record = kind === 'format4' ? JSON.stringify({ recordFormatVersion: 4 }) : kind === 'invalid' ? '{'
        : serializeRun(createRun(runId, { ownerSessionId: id, objective: 'Synthetic preserved run.', authority: { owner: 'user' },
          admission: admitIntake({ purpose: 'implementation', entry: 'detective', rationale: 'Synthetic history.' }, [
            captureIntakeMaterial('current-request', 'Synthetic earlier question.', { sessionId: id, eventIndex: 1 }),
          ]),
        }))
      session.append('conductor/checkpoint', { runId, record })
    }
    await ctx.sessionPersistence.create(session.header)
    await ctx.sessionPersistence.append(id, session.events)
  }
  const before = await artifacts()
  assert.ok(Object.keys(before).length > 0)
  if (refusal) {
    await assert.rejects(ctx.agents.resume({ resumeSessionId: id }), (error: unknown) => {
      assert.ok(error instanceof Error)
      assert.equal(error.name, 'SessionFormatUnsupportedError')
      assert.match(error.message, /conductor\/checkpoint.*enable the compatible plugin bundle/)
      process.stdout.write(`${error.message.split(' (raw log:')[0]}\n`)
      return true
    })
    assert.equal(ctx.sessions.get(id), undefined)
    assert.equal(published, 0)
    process.stdout.write('Replay: refused before session/agent publication\n')
  } else {
    await ctx.sessionPersistence.inspect(id)
    assert.deepEqual(await artifacts(), before)
    assert.equal(ctx.sessions.get(id), undefined)
    assert.equal(published, 0)
    process.stdout.write('History inspection: byte-identical; unpublished\n')
    const handle = await ctx.agents.resume({ resumeSessionId: id })
    await handle.agent.whenIdle()
    const text = handle.agent.session.deriveMessages().flatMap(message => message.content)
      .filter(block => block.type === 'text').map(block => block.text)
    assert.deepEqual(text, ['Synthetic earlier question.', 'Synthetic earlier answer.'])
    process.stdout.write(`History: ${text.join(' / ')}\n`)
    if (enabled) {
      const values = ctx.sessionProjections.snapshot(handle.agent.session).values
      assert.deepEqual(values.conductorChildren, {})
      const unavailable = kind === 'format4' ? { [runId]: { format: 4 } } : kind === 'invalid' ? { [runId]: { format: null } } : {}
      assert.deepEqual(values.conductorUnavailableRuns, unavailable)
      const store = new SessionConductorRunStore(handle.agent.session, () => Promise.resolve())
      if (kind === 'format4' || kind === 'invalid') {
        await assert.rejects(store.load(runId), /cannot be resumed/)
        process.stdout.write(`Conductor: cannot be resumed (format ${kind === 'format4' ? '4' : 'unknown'})\n`)
      } else {
        assert.equal((await store.load(runId))?.runId, runId)
        process.stdout.write('Conductor: current record readable; no automatic work\n')
      }
    } else process.stdout.write('Ordinary chat: readable without Conductor\n')
    await handle.dispose()
  }
  await ctx.fiber.dispose()
  ctx = undefined
  const after = await artifacts()
  assert.deepEqual(Object.keys(after), Object.keys(before))
  for (const [path, original] of Object.entries(before)) {
    const restored = after[path]!
    assert.equal(restored.slice(0, original.length), original)
    const appended = restored.slice(original.length).trim().split('\n').filter(Boolean)
    if (refusal || action === 'reopen') assert.equal(appended.length, 0)
    else {
      assert.equal(appended.length, 1)
      assert.equal((JSON.parse(appended[0]!) as { type: string }).type, 'session/end-seed')
    }
  }
  assert.equal(modelCalls, 0)
  assert.equal(toolCalls, 0)
  process.stdout.write(`${refusal ? 'Session artifacts: byte-identical' : 'Original history: byte-identical; seed boundary only on initial resume'}\nModel requests: 0; tool executions: 0\n`)
} finally {
  await ctx?.fiber.dispose()
}
