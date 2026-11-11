import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareCiAptMirrors } from './prepare-ci-apt-mirrors.ts'

const script = fileURLToPath(new URL('./prepare-ci-apt-mirrors.ts', import.meta.url))
const originalMirrors = 'http://azure.archive.ubuntu.com/ubuntu/\tpriority:1\nhttps://archive.ubuntu.com/ubuntu/\tpriority:2\nhttps://security.ubuntu.com/ubuntu/\tpriority:3\n'
const originalSource = 'Types: deb\nURIs: mirror+file:/etc/apt/apt-mirrors.txt\nSuites: noble noble-updates noble-security\nComponents: main universe\nSigned-By: /usr/share/keyrings/ubuntu-archive-keyring.gpg\n'
const fixtures: string[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function createAptTree(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-ci-apt-'))
  fixtures.push(root)
  mkdirSync(join(root, 'sources.list.d'))
  mkdirSync(join(root, 'apt.conf.d'))
  writeFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), originalSource)
  writeFileSync(join(root, 'apt-mirrors.txt'), originalMirrors)
  writeFileSync(join(root, 'apt.conf.d', 'zz-retries'), 'Acquire::Retries "3";\n')
  return root
}

function expectUnchanged(root: string, source = originalSource): void {
  expect(readFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8')).toBe(source)
  expect(readFileSync(join(root, 'apt-mirrors.txt'), 'utf8')).toBe(originalMirrors)
  expect(readdirSync(join(root, 'apt.conf.d'))).toEqual(['zz-retries'])
}

describe('hosted CI APT preparation', () => {
  it('prefers the independent mirror while preserving original mirrors, suites and signatures', () => {
    const root = createAptTree()
    prepareCiAptMirrors(root, 'github-hosted')

    expect(readFileSync(join(root, 'apt-mirrors.txt'), 'utf8'))
      .toBe(`https://mirrors.edge.kernel.org/ubuntu/\tpriority:0\n${originalMirrors}`)
    expect(readFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8')).toBe(originalSource)
    expect(readFileSync(join(root, 'apt.conf.d', 'zzzz-dsh-ci-downloads'), 'utf8'))
      .toBe('Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n')
    expect(readFileSync(join(root, 'apt.conf.d', 'zz-retries'), 'utf8')).toBe('Acquire::Retries "3";\n')
  })

  it('does not duplicate the preferred mirror when preparation repeats', () => {
    const root = createAptTree()
    prepareCiAptMirrors(root, 'github-hosted')
    const first = readFileSync(join(root, 'apt-mirrors.txt'), 'utf8')
    prepareCiAptMirrors(root, 'github-hosted')
    expect(readFileSync(join(root, 'apt-mirrors.txt'), 'utf8')).toBe(first)
  })

  it.each(['self-hosted', undefined])('refuses %s hosts before changing files', (environment) => {
    const root = createAptTree()
    expect(() => { prepareCiAptMirrors(root, environment) }).toThrow('Refusing to change APT')
    expectUnchanged(root)
  })

  it('refuses an unrecognized source layout before changing files', () => {
    const root = createAptTree()
    const directSource = originalSource.replace('mirror+file:/etc/apt/apt-mirrors.txt', 'https://archive.ubuntu.com/ubuntu/')
    writeFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), directSource)
    expect(() => { prepareCiAptMirrors(root, 'github-hosted') }).toThrow('Unsupported Ubuntu APT layout')
    expectUnchanged(root, directSource)
  })

  it('refuses an empty mirror list before writing configuration', () => {
    const root = createAptTree()
    writeFileSync(join(root, 'apt-mirrors.txt'), '')
    expect(() => { prepareCiAptMirrors(root, 'github-hosted') }).toThrow('mirror list is empty')
    expect(readFileSync(join(root, 'apt-mirrors.txt'), 'utf8')).toBe('')
    expect(readdirSync(join(root, 'apt.conf.d'))).toEqual(['zz-retries'])
  })

  it('rejects a relative configuration directory', () => {
    expect(() => { prepareCiAptMirrors('etc/apt', 'github-hosted') }).toThrow('must be an absolute path')
  })

  it('runs the real Node entry against an isolated APT tree', () => {
    const root = createAptTree()
    const result = spawnSync(process.execPath, ['--import', 'tsx', script, root], {
      env: { ...process.env, RUNNER_ENVIRONMENT: 'github-hosted' },
      encoding: 'utf8',
    })
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(join(root, 'apt-mirrors.txt'), 'utf8')).toContain('priority:0')
    expect(readFileSync(join(root, 'sources.list.d', 'ubuntu.sources'), 'utf8')).toBe(originalSource)
  })
})
