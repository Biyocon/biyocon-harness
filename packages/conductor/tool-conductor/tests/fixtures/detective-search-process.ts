/** Owned source launcher: real child composition and search execution across processes. */
import { Context } from '@deepseek-ai/cordis'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor'
import { CallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { detectiveSearchContribution, resolveDetectiveSearchPolicy } from '../../src/detective-search.ts'

const [cwd, storageRoot, childId, argumentsJson] = process.argv.slice(2)
if (cwd === undefined || storageRoot === undefined || childId === undefined || argumentsJson === undefined) {
  throw new Error('Expected synthetic workspace, private store, trusted child and JSON arguments')
}
const ctx = new Context()
try {
  await mountAgentLoopTestDependencies(ctx)
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(LocalSubprocessRuntime)
  const install = detectiveSearchContribution(ctx, ConductorRunId('CON-2026-5802'), resolveDetectiveSearchPolicy({
    detectiveSearchSnapshotRoot: storageRoot, detectiveSearch: { grepMaxMatches: 1 },
  }))
  const handle = await ctx.agents.create({ sessionId: SessionId(childId), meta: { cwd },
    agentOptions: { provider: 'unused', model: 'unused' }, setup: (childCtx) => { childCtx.effect(() => install(childCtx)) } })
  const result = await ctx.tools.execute({ name: 'grep', arguments: JSON.parse(argumentsJson) as unknown, agent: handle.agent,
    callId: CallId('process-search'), signal: new AbortController().signal })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} finally {
  await ctx.fiber.dispose()
}
