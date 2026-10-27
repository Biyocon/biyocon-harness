import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = join(dirname(fileURLToPath(import.meta.url)), 'wine-apt-cache.mjs')
const temporary: string[] = []
const sha256 = (bytes: string) => createHash('sha256').update(bytes).digest('hex')

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'wine-cache-'))
  temporary.push(directory)
  const log = join(directory, 'apt.log')
  const plan = join(directory, 'wine-plan.json')
  const output = join(directory, 'github-output')
  const packages = [
    { name: 'libwine_9.0_amd64.deb', bytes: 'wine-library-fixture' },
    { name: 'wine_9.0_all.deb', bytes: 'wine-dispatcher-fixture' },
  ] as const
  const entries = packages.map(({ name, bytes }) => `'https://archive.ubuntu.com/${name}' ${name} ${Buffer.byteLength(bytes)} SHA256:${sha256(bytes)}`)
  writeFileSync(log, `Reading package lists...\n${entries.join('\n')}\n`)
  for (const { name, bytes } of packages) writeFileSync(join(directory, name), bytes)
  return { directory, log, plan, output, packages }
}

function run(args: string[], output?: string) {
  const env = { ...process.env }
  delete env.GITHUB_OUTPUT
  if (output) env.GITHUB_OUTPUT = output
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
}

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('Wine apt cache', () => {
  it('validates every planned archive before accepting the collection', () => {
    const f = fixture()
    expect(run(['plan', f.log, '9.0', 'ubuntu24-image1', f.plan], f.output).status).toBe(0)
    const key = readFileSync(f.output, 'utf8').trim().slice('key='.length)
    expect(key).toMatch(/^wine-debs-v3-ubuntu24-image1-9\.0-[a-f0-9]{64}$/)
    const checked = run(['validate', f.plan, f.directory, 'ubuntu24-image1', key])
    expect(checked.status).toBe(0)
    expect(checked.stdout).toContain('complete collection: 2 archives')
    expect(checked.stdout).toContain('libwine_9.0_amd64.deb')
    expect(run(['version', f.plan]).stdout.trim()).toBe('9.0')
    expect(run(['validate', f.plan, f.directory, 'ubuntu24-image1', 'stale-key']).stderr).toContain('does not match the requested key')
    expect(run(['validate', f.plan, f.directory, 'different-image', key]).stderr).toContain('runner image mismatch')
  })

  it('uses canonical Ubuntu endpoints for mirrored archive bytes', () => {
    const f = fixture()
    const record = (uri: string, name: string) => `'${uri}' ${name} 20 SHA256:${'a'.repeat(64)}`
    writeFileSync(f.log, [
      record('mirror+file:/etc/apt/apt-mirrors.txt/pool/main/a/a.deb', 'a_1_all.deb'),
      record('mirror+file:/etc/apt/apt-mirrors-security.txt/pool/main/b/b.deb', 'b_1_all.deb'),
      record('http://azure.archive.ubuntu.com/ubuntu/pool/main/c/c.deb', 'c_1_all.deb'),
    ].join('\n'))
    expect(run(['plan', f.log, '9.0', 'image1', f.plan]).status).toBe(0)
    const urls = run(['downloads', f.plan]).stdout
    expect(urls).toContain('https://archive.ubuntu.com/ubuntu/pool/main/a/a.deb\ta_1_all.deb')
    expect(urls).toContain('https://security.ubuntu.com/ubuntu/pool/main/b/b.deb\tb_1_all.deb')
    expect(urls).toContain('https://archive.ubuntu.com/ubuntu/pool/main/c/c.deb\tc_1_all.deb')
    expect(urls).not.toContain('azure.')
  })

  it('changes the key for Wine versions, image versions and dependency bytes', () => {
    const f = fixture()
    const keys = new Set<string>()
    for (const [wine, image] of [['9.0', 'image1'], ['9.1', 'image1'], ['9.0', 'image2']] as const) {
      expect(run(['plan', f.log, wine, image, f.plan], f.output).status).toBe(0)
      keys.add(readFileSync(f.output, 'utf8').trim().split('\n').at(-1)!)
    }
    writeFileSync(f.log, readFileSync(f.log, 'utf8').replace(sha256(f.packages[0].bytes), sha256('changed-library')))
    expect(run(['plan', f.log, '9.0', 'image1', f.plan], f.output).status).toBe(0)
    keys.add(readFileSync(f.output, 'utf8').trim().split('\n').at(-1)!)
    expect(keys.size).toBe(4)
  })

  it.each(['missing', 'truncated', 'corrupt', 'extra'] as const)('rejects a %s archive collection', (change) => {
    const f = fixture()
    expect(run(['plan', f.log, '9.0', 'image1', f.plan]).status).toBe(0)
    const library = join(f.directory, f.packages[0].name)
    const expected = { missing: 'missing archive', truncated: 'size mismatch', corrupt: 'SHA256 mismatch', extra: 'unexpected archives' }
    switch (change) {
      case 'missing': rmSync(library); break
      case 'truncated': writeFileSync(library, 'short'); break
      case 'corrupt': writeFileSync(library, 'X'.repeat(f.packages[0].bytes.length)); break
      case 'extra': writeFileSync(join(f.directory, 'unplanned_1_all.deb'), 'extra'); break
    }
    const checked = run(['validate', f.plan, f.directory, 'image1'])
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain(expected[change])
  })

  it('rejects archive links instead of hashing a different file', () => {
    const f = fixture()
    expect(run(['plan', f.log, '9.0', 'image1', f.plan]).status).toBe(0)
    const library = join(f.directory, f.packages[0].name)
    rmSync(library)
    symlinkSync(f.log, library, 'file')
    const checked = run(['validate', f.plan, f.directory, 'image1'])
    expect(checked.status).toBe(1)
    expect(checked.stderr).toContain('not a regular file')
  })

  it.each([
    "'https://example/lib.deb' lib_1_all.deb 20 MD5Sum:abc",
    "'https://example/lib.deb' ../lib_1_all.deb 20 SHA256:" + 'a'.repeat(64),
    'Reading package lists...\n',
  ])('rejects incomplete or unsafe apt plans: %s', (line) => {
    const f = fixture()
    writeFileSync(f.log, line)
    expect(run(['plan', f.log, '9.0', 'image1', f.plan]).status).toBe(1)
  })

  it('rejects duplicate archive records and mismatched stored plans', () => {
    const f = fixture()
    const text = readFileSync(f.log, 'utf8')
    writeFileSync(f.log, text + text)
    expect(run(['plan', f.log, '9.0', 'image1', f.plan]).stderr).toContain('duplicate archive')
    writeFileSync(f.log, text)
    const expectedPlan = join(f.directory, 'expected.json')
    expect(run(['plan', f.log, '9.0', 'image1', expectedPlan]).status).toBe(0)
    expect(run(['plan', f.log, '9.1', 'image1', f.plan]).status).toBe(0)
    expect(run(['validate', expectedPlan, f.directory, 'image1']).stderr).toContain('stored plan differs')
  })

  it('requires an apt transcript without archive acquisitions', () => {
    const f = fixture()
    writeFileSync(f.log, 'Reading package lists...\nUnpacking wine...\n')
    const offline = run(['offline-log', f.log])
    expect(offline.status).toBe(0)
    expect(offline.stdout).toContain('Get: lines=0')
    writeFileSync(f.log, 'Get:1 https://archive.ubuntu.com libwine [105 MB]\n')
    const download = run(['offline-log', f.log])
    expect(download.status).toBe(1)
    expect(download.stderr).toContain('offline apt unexpectedly acquired archives')
  })
})
