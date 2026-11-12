import { appendFile, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { sourceLaunchFixture } from './fixtures/source-launch-fixture.ts'

const fixtures: Array<Awaited<ReturnType<typeof sourceLaunchFixture>>> = []
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map(fixture => fixture.dispose()))
})
async function fixture() {
  const value = await sourceLaunchFixture()
  fixtures.push(value)
  return value
}

describe('source launch prepares installed Conductor instructions', () => {
  it('creates missing assets outside the task workspace and refreshes all instructions on the next launch', async () => {
    const f = await fixture()
    const initial = await f.launch()
    expect(initial.stderr).toBe('')
    expect(initial.exitCode).toBe(0)
    expect(JSON.parse(initial.stdout)).toEqual({ mounted: true, roleFresh: false, sharedFresh: false, protocolFresh: false })
    for (const [path, marker] of [
      ['conductor/roles/01-detective.md', 'ROLE'],
      ['conductor/README.md', 'SHARED'],
      ['skills/conductor-specialist/SKILL.md', 'PROTOCOL'],
    ]) await appendFile(join(f.checkout, '.agents', path!), `\nSOURCE_${marker}_NEW\n`)
    const next = await f.launch()
    expect(next.stderr).toBe('')
    expect(next.exitCode).toBe(0)
    expect(JSON.parse(next.stdout)).toEqual({ mounted: true, roleFresh: true, sharedFresh: true, protocolFresh: true })
  }, 30_000)

  it('allows two simultaneous source launches with separate homes and one installation', async () => {
    const f = await fixture()
    const results = await Promise.all([f.launch(), f.launch()])
    for (const result of results) {
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(JSON.parse(result.stdout)).toMatchObject({ mounted: true })
    }
  }, 30_000)

  it.each(['missing', 'empty', 'malformed'] as const)('rejects a %s required role before a reader can run', async (kind) => {
    const f = await fixture()
    const role = join(f.checkout, '.agents/conductor/roles/01-detective.md')
    if (kind === 'missing') await rm(role)
    else await writeFile(role, kind === 'empty' ? '---\nname: conductor-detective\ndescription: empty\n---\n' : '---\nname: [invalid\n---\n')
    const result = await f.launch()
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).not.toContain('"mounted":true')
    expect(result.stderr).toMatch(/conductor-detective|01-detective.md|conductor-roles|YAML|end of the stream/)
  }, 30_000)

  it('reports generation failure and never boots with stale resources', async () => {
    const f = await fixture()
    expect((await f.launch()).exitCode).toBe(0)
    const installed = join(f.checkout, 'packages/conductor/conductor-host-rc7/presets/conductor/skills/README.md')
    const before = await readFile(installed)
    await rm(join(f.checkout, '.agents/conductor/README.md'))
    const result = await f.launch()
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('dsh: could not prepare Conductor skills:')
    expect(await readFile(installed)).toEqual(before)
  }, 30_000)
})


describe('bundle roots through the real source CLI composition', () => {
  it('trusts only the CLI and explicit bundle roots, despite configured system trust', async () => {
    const f = await fixture()
    const result = await f.launch(undefined, 'combined')
    expect(result.exitCode, result.stderr).toBe(0)
    expect((JSON.parse(result.stdout) as { roster: Array<[string, string]> }).roster).toEqual([['cli', 'system'], ['bundle', 'system'], ['configured', 'user']])
  }, 30_000)

  it('does not promote a patch root or reject its duplicate id as a system collision', async () => {
    const f = await fixture()
    const result = await f.launch(undefined, 'patch-collision')
    expect(result.exitCode, result.stderr).toBe(0)
    expect((JSON.parse(result.stdout) as { roster: Array<[string, string]> }).roster).toEqual([['cli', 'system'], ['bundle', 'system']])
    expect(result.stderr).not.toContain('duplicate system preset')
  }, 30_000)

  it('refuses a bundle id that collides with the CLI system root', async () => {
    const f = await fixture()
    const result = await f.launch(undefined, 'collision')
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain('duplicate system preset "bundle"')
  }, 30_000)
})
