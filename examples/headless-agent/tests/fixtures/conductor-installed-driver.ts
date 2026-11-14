/** Drive the shipped Conductor preset through its real creation-time mount. */
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '../../../../packages/conductor/tool-conductor/src/owner-controller.ts'

const [configPath, task] = process.argv.slice(2)
if (configPath === undefined || task === undefined) throw new Error('expected config and task')
const uninstall = installFailLoud('conductor-installed-snapshot')
const missingAdmission = process.env.DSH_CONDUCTOR_MISSING_ADMISSION === '1'
let modelRequests = 0
let ctx: Context | undefined
try {
  ctx = await boot('conductor-installed-snapshot', resolveConfigPath(configPath, undefined))
  const runtime = ctx
  // This raw example declares its own synthetic vocabulary; profile tests own manifest admission.
  if (!missingAdmission) runtime.sessions.registerEventTypes(CONDUCTOR_SESSION_EVENT_TYPES)
  else runtime.on('agent/request', () => { modelRequests++; throw new Error('unexpected model request before producer admission') })
  const agentOptions = { provider: 'conductor-installed', model: 'conductor-installed' }
  const setup = (agentCtx: Context) => runtime.agentPresets.mount(agentCtx, 'conductor').then(() => undefined)
  if (process.env.DSH_CONDUCTOR_RESUME_RUN_ID === undefined) {
    const seed = process.env.DSH_CONDUCTOR_OLD_RECORD === '1' ? (() => {
      const session = Session.create(SessionId('conductor-installed-parent'))
      session.append('user/message', createUserMessage({ source: { kind: 'user' },
        content: [{ type: 'text', text: 'Synthetic earlier question.' }] }), { surfaceOp: 'append' })
      session.append('conductor/checkpoint', { runId: ConductorRunId('CON-2026-0004'),
        record: JSON.stringify({ recordFormatVersion: 4 }) })
      return session.events
    })() : undefined
    await runtime.agents.create({
      sessionId: SessionId('conductor-installed-parent'),
      meta: { cwd: process.cwd(), agentPreset: 'conductor' }, agentOptions, setup,
      ...seed === undefined ? {} : { seed },
    })
  } else {
    await runtime.agents.resume({ resumeSessionId: SessionId('conductor-installed-parent'), agentOptions, setup })
  }
  const agent = runtime.agents.roots()[0]
  if (agent === undefined) throw new Error('Conductor fixture root agent was not created')
  if (process.env.DSH_CONDUCTOR_INTAKE_SCENARIO === 'critic-resume-pause') {
    runtime.on('session/event', (session, event) => {
      if (session !== agent.session || event.type !== 'conductor/checkpoint' || event.data.record === null) return
      const run = JSON.parse(event.data.record) as { status: string; currentStage: string; analysisMode: string | null }
      if (run.status === 'running' && run.currentStage === 'devils-advocate' && run.analysisMode === 'critic') {
        agent.cancel({ kind: 'hook', reason: 'keyless fixture process restart before critic dispatch' })
      }
    })
  }
  const imageScenario = process.env.DSH_CONDUCTOR_INTAKE_SCENARIO === 'critic-image'
  const result = imageScenario ? await (async () => {
    await agent.whenIdle()
    agent.followup(createUserMessage({ source: { kind: 'user' }, content: [
      { type: 'text', text: task },
      { type: 'image', attachment: { attachmentId: 'fixture-image' as never,
        mediaType: 'image/png', bytes: 1, width: 1, height: 1 } },
    ] }))
    await agent.whenIdle()
    await runtime.sessions.flush(agent.session)
    return { type: 'result' as const, sessionId: agent.session.id, output: '' }
  })() : await runFixtureTurn(runtime, { task })
  await runtime.get('conductorOwnerHostTest')?.settled
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const refusal = message.match(/Conductor cannot produce required event type "conductor\/[^\"]+";[^\n]*tool-conductor/)
  if (missingAdmission && refusal !== null && modelRequests === 0) {
    process.stdout.write(refusal[0] + '\nModel requests: 0\n')
  } else {
    process.stderr.write(message + '\n')
    process.exitCode = 1
  }
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
