/**
 * Parent-only task routing for the Conductor preset.
 * @module @deepseek-ai/dsh-tool-conductor/mode-routing
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'

type Phase = 'waiting' | 'running' | 'stopped' | 'complete'

/**
 * Require a Conductor dispatch before parent workspace tools and stop solo fallback.
 * Specialist scopes retain their independently restricted tools. Registrations
 * belong to the mounting fiber; no generic instruction or loop policy changes.
 * @param ctx - context of the mode-enabled Conductor tool.
 */
export function installModeRouting(ctx: Context): void {
  const phases = new WeakMap<object, Phase>()
  const isParent = (agent: Agent): boolean => agent.session.header.origin !== 'subagent'

  ctx.on('agent/inbox/claimed', ({ agent, message }) => {
    if (isParent(agent) && message.source.kind === 'user') {
      phases.set(agent, 'waiting')
    }
  })

  ctx.on('system-prompt/assemble', async (_assembly, context, next) => {
    const assembly = await next()
    const agent = context.agent
    if (agent !== undefined && isParent(agent)) {
      const phase = phases.get(agent) ?? 'waiting'
      if (phase === 'complete') return assembly
      assembly.tools = assembly.tools.filter(tool => phase === 'waiting' && tool.name === 'conductor')
    }
    return assembly
  })

  ctx.tools.guard((exec) => {
    const agent = exec.agent
    if (agent === undefined || !isParent(agent)) return undefined
    const phase = phases.get(agent) ?? 'waiting'
    if (phase === 'complete') return undefined
    if (phase === 'waiting' && exec.name === 'conductor') return undefined
    return phase === 'waiting'
      ? 'Conductor mode requires conductor as the first tool call for each new task; do not inspect the workspace yourself.'
      : 'Conductor mode does not allow solo fallback or another dispatch for this task; report the Conductor result and stop.'
  })

  ctx.on('tools/execute', async (exec, next) => {
    if (exec.agent !== undefined && isParent(exec.agent) && exec.name === 'conductor') {
      phases.set(exec.agent, 'running')
    }
    return next()
  })

  ctx.on('tools/result', (exec, result) => {
    if (exec.agent === undefined || !isParent(exec.agent) || exec.name !== 'conductor') return
    const value = result.value
    const outcome = value !== null && typeof value === 'object' && !Array.isArray(value) ? value['result'] : undefined
    const completed = !result.isError && outcome !== null && typeof outcome === 'object' && !Array.isArray(outcome)
      && outcome['kind'] === 'decision'
    phases.set(exec.agent, completed ? 'complete' : 'stopped')
  })

  ctx.on('agent/turn-stopping', ({ agent }) => {
    if (isParent(agent) && (phases.get(agent) ?? 'waiting') === 'waiting') {
      throw new Error('Conductor mode task ended without calling conductor; no specialist workflow was started.')
    }
  })
}
