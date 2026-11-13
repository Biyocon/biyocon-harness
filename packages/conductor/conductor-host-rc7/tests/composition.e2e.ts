import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor'

it('registers both replay projections through the actual host bundle before a preset mounts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conductor-host-composition-'))
  try {
    const config = join(directory, 'cordis.yml')
    await writeFile(config, "- id: projections\n  name: '@deepseek-ai/dsh-session-projection'\n")
    const patch = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
    const ctx = await boot('test', config, loadOverlayPatches('test', patch), undefined, new URL('../', import.meta.url).href)
    try {
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
