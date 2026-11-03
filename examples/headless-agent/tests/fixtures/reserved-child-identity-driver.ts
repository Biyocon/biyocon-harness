#!/usr/bin/env node
/** Boot the headless example and dispatch one host-composed workflow child. */

import type { Context } from '@deepseek-ai/cordis'
import { boot, installFailLoud, loadEnv, resolveConfigPath } from '@deepseek-ai/dsh-app-boot'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-workflow-worker-thread'
import { installReservedIdentityAdapter } from './reserved-child-identity-mock.ts'

const NAME = 'reserved-child-identity-driver'
const configPath = process.argv[2]
if (configPath === undefined) throw new Error(`${NAME}: expected <config-path>`)

const uninstallFailLoud = installFailLoud(NAME)
let ctx: Context | undefined
try {
  loadEnv(NAME)
  ctx = await boot(NAME, resolveConfigPath(configPath, undefined))
  installReservedIdentityAdapter(ctx)
  const parent = ctx.agentLoop.create(SessionId('reserved-identity-parent'), {
    provider: 'reserved-identity-mock', model: 'reserved-identity-mock',
  })
  let reservedId: SessionId | undefined
  const run = ctx.workflowEngine.start({
    meta: { name: 'reserved-identity', description: 'Identify the actual child session in its prompt.' },
    script: "return await agent('identify the child')",
    parent,
    composeChildPrompt: (id, prompt) => {
      reservedId = id
      return [{ type: 'text', text: `${prompt}. Confirm the session identity using the following metadata.\nactual-child-id:${id}` }]
    },
  })
  try {
    const result = await run.result
    if (result.stopReason !== 'completed' || result.value !== 'IDENTIFIED' || reservedId === undefined) {
      throw new Error(`reserved child workflow failed: ${JSON.stringify(result)}`)
    }
    process.stdout.write(`${JSON.stringify({ type: 'result', childId: reservedId, value: result.value })}\n`)
  } finally {
    await run.dispose()
  }
} catch (error: unknown) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
} finally {
  await ctx?.fiber.dispose()
  uninstallFailLoud()
}
