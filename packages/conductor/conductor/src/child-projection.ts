/** Durable, model-hidden Conductor child presentation. */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { ConductorChild } from './child-types.ts'

const childSchema = z.object({
  childId: z.string(), runId: z.string(),
  role: z.enum(['detective', 'strategist', 'devils-advocate', 'headsman', 'auditor', 'integrator', 'arbiter', 'ralph']),
  attempt: z.number().int().positive(), historyOffset: z.number().int().nonnegative(),
  status: z.enum(['running', 'completed', 'failed']),
  gate: z.object({ id: z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']), decision: z.enum(['pass', 'rework', 'escalate', 'abort']), reworks: z.number().int().nonnegative(), limit: z.number().int().positive() }).optional(),
})

/** Durable parent projection; unrelated sessions and children are absent. */
export const conductorChildrenProjection: ProjectionDefinition<'conductorChildren', Record<string, ConductorChild>> = {
  key: 'conductorChildren',
  schema: z.record(z.string(), childSchema) as unknown as z.ZodType<Record<string, ConductorChild>>,
  init: () => ({}),
  apply: (state, event) => event.type === 'session/end-seed' ? {} : event.type === 'conductor/child' ? { ...state, [event.data.childId]: event.data } : state,
  view: state => state,
  stateVersion: 1,
}
