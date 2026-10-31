/** Drive the shipped Conductor preset through its real creation-time mount. */
import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { runFixtureTurn } from '@deepseek-ai/dsh-loader-smoke'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-presets'
import type {} from '../../../../packages/conductor/tool-conductor/src/owner-controller.ts'

const [configPath, task] = process.argv.slice(2)
if (configPath === undefined || task === undefined) throw new Error('expected config and task')
const uninstall = installFailLoud('conductor-installed-snapshot')
let ctx: Context | undefined
try {
  ctx = await boot('conductor-installed-snapshot', resolveConfigPath(configPath, undefined))
  const runtime = ctx
  await runtime.agents.create({
    sessionId: SessionId('conductor-installed-parent'),
    meta: { cwd: process.cwd(), agentPreset: 'conductor' },
    agentOptions: { provider: 'conductor-installed', model: 'conductor-installed' },
    setup: agentCtx => runtime.agentPresets.mount(agentCtx, 'conductor').then(() => undefined),
  })
  const result = await runFixtureTurn(runtime, { task })
  await runtime.get('conductorOwnerHostTest')?.settled
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstall()
}
