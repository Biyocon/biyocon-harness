import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId, CONDUCTOR_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-conductor'
import { collectLogEvents } from '../../../../scripts/gen-persistence-catalog.ts'

it('registers both replay projections through the actual host bundle before a preset mounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conductor-host-composition-'))
  try {
    const config = join(directory, 'cordis.yml')
    await writeFile(config, "- id: sessions\n  name: '@deepseek-ai/dsh-session'\n- id: projections\n  name: '@deepseek-ai/dsh-session-projection'\n")
    const patch = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
    const ctx = await boot('test', config, loadOverlayPatches('test', patch), undefined, new URL('../', import.meta.url).href)
    try {
      const declared = collectLogEvents().filter(event => event.source.startsWith('packages/conductor/conductor/'))
      expect(declared).toHaveLength(7)
      expect(declared.every(event => event.registrationRequired)).toBe(true)
      expect([...CONDUCTOR_SESSION_EVENT_TYPES].sort()).toEqual(declared.map(event => event.name).sort())
      for (const type of CONDUCTOR_SESSION_EVENT_TYPES) expect(ctx.sessions.supportsEventType(type)).toBe(true)
      const runId = ConductorRunId('CON-2026-0037')
      const session = Session.create(SessionId('synthetic-owner'))
      session.append('conductor/checkpoint', { runId, record: JSON.stringify({ recordFormatVersion: 4 }) })
      session.append('session/end-seed', {})
      const snapshot = ctx.sessionProjections.snapshot(Session.create(session.id, session.events))
      expect(snapshot.values.conductorChildren).toEqual({})
      expect(snapshot.values.conductorUnavailableRuns).toEqual({ [runId]: { format: 4 } })
    } finally {
      await ctx.fiber.dispose()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
