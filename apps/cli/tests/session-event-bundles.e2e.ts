import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execa } from 'execa'
import { expect, it } from 'vitest'

it('boots the ordinary session provider with two explicit bundles and excludes their transitive event grants', async () => {
  const home = await mkdtemp(join(tmpdir(), 'session-event-profile-'))
  const profile = join(home, 'profiles/events')
  const bin = fileURLToPath(new URL('../lib/bin.js', import.meta.url))
  try {
    await mkdir(profile, { recursive: true })
    const probe = join(profile, 'probe.mjs')
    await writeFile(probe, `export const inject = ['sessions', 'appExit']
export function apply(ctx) {
  console.log(JSON.stringify({ provider: ctx.sessions.constructor.name,
    first: ctx.sessions.supportsEventType('first/event'), second: ctx.sessions.supportsEventType('second/event'),
    indirect: ctx.sessions.supportsEventType('indirect/event'), patch: ctx.sessions.supportsEventType('patch/event') }))
  ctx.appExit(0)
}`)
    for (const [name, types] of [['first', ['first/event']], ['second', ['second/event']], ['indirect', ['indirect/event']]] as const) {
      const directory = join(profile, 'node_modules', name)
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '0.0.0',
        dependencies: name === 'first' ? { indirect: '0.0.0' } : {},
        dsh: { bundle: { patch: './cordis.patch.yml', sessionEventTypes: types } } }))
      await writeFile(join(directory, 'cordis.patch.yml'), name === 'first'
        ? JSON.stringify([{ insert: [{ id: 'session', name: '@deepseek-ai/dsh-session' }, { id: 'probe', name: pathToFileURL(probe).href }] }])
        : '[]\n')
    }
    await writeFile(join(profile, 'package.json'), JSON.stringify({ name: 'synthetic-event-profile', private: true,
      dsh: { profile: { bundles: ['first', 'second'] } } }))
    await writeFile(join(profile, 'cordis.patch.yml'), '- id: session\n  config:\n    sessionEventTypes: [patch/event]\n')
    const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/(KEY|TOKEN|SECRET|PASSWORD)/i.test(key)))
    const options = { cwd: home, env: { ...cleanEnv, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }, extendEnv: false,
      timeout: 20_000, input: '' } as const
    const dump = await execa(process.execPath, [bin, '--profile', 'events', '--dump-config'], options)
    expect(dump.stdout).toContain('first/event')
    expect(dump.stdout).toContain('second/event')
    const result = await execa(process.execPath, [bin, '--profile', 'events'], options)
    expect(result.stderr).toBe('')
    expect(JSON.parse(result.stdout)).toEqual({ provider: 'SessionStore', first: true, second: true, indirect: false, patch: false })
  } finally { await rm(home, { recursive: true, force: true }) }
})
