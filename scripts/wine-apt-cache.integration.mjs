/** Real apt/dpkg fixture with a private package database and a loopback repository. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Wine apt integration requires Linux root for a private dpkg root and network namespace')
const exec = promisify(execFile)
const script = join(dirname(fileURLToPath(import.meta.url)), 'wine-apt-cache.sh')
const root = await mkdtemp(join(tmpdir(), 'wine-apt-fixture-'))
const hostPackageStatus = await readFile('/var/lib/dpkg/status')
await chmod(root, 0o755)
const repo = join(root, 'repo')
const installed = join(root, 'installed')
const archives = join(root, 'wine-debs')
const plan = join(root, 'plan.json')
const config = join(root, 'apt.conf')
const env = { ...process.env, APT_CONFIG: config, ImageOS: 'fixture', ImageVersion: '1', LC_ALL: 'C' }
delete env.GITHUB_OUTPUT
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`
let requests = 0
const files = new Map()
const server = createServer(async (request, response) => {
  requests++
  const name = new URL(request.url, 'http://localhost').pathname.slice(1)
  if (name === 'probe') { response.end('network available'); return }
  const path = files.get(name)
  if (!path) { response.writeHead(404).end(); return }
  response.end(await readFile(path))
})

async function run(command, args, expected = 0, overrides = {}) {
  let result
  try {
    result = await exec(command, args, { env: { ...env, ...overrides }, maxBuffer: 1024 * 1024 })
    assert.equal(expected, 0, `${command} unexpectedly succeeded`)
  } catch (error) {
    if (error.code !== expected) throw error
    result = error
  }
  return result.stdout + result.stderr
}

try {
  await mkdir(repo)
  for (const directory of ['var/lib/dpkg/updates', 'var/lib/dpkg/info', 'var/log']) await mkdir(join(installed, directory), { recursive: true })
  for (const directory of ['lists/partial', 'apt-archives/partial', 'log']) await mkdir(join(root, directory), { recursive: true })
  await writeFile(join(installed, 'var/lib/dpkg/status'), '')
  for (const name of ['libwine-fixture', 'wine']) {
    const packageRoot = join(root, name)
    await mkdir(join(packageRoot, 'DEBIAN'), { recursive: true })
    const dependency = name === 'wine' ? 'Depends: libwine-fixture (= 1.0)\n' : ''
    await writeFile(join(packageRoot, 'DEBIAN/control'), `Package: ${name}\nVersion: 1.0\nArchitecture: all\nMaintainer: fixture <fixture@example.test>\n${dependency}Description: private Wine apt fixture\n`)
    await mkdir(join(packageRoot, 'usr/share/wine-fixture'), { recursive: true })
    await writeFile(join(packageRoot, `usr/share/wine-fixture/${name}`), 'ready\n')
    const filename = `${name}_1.0_all.deb`
    const path = join(repo, filename)
    await run('dpkg-deb', ['--build', '--root-owner-group', packageRoot, path])
    files.set(filename, path)
  }
  const packages = await exec('dpkg-scanpackages', ['.', '/dev/null'], { cwd: repo })
  await writeFile(join(repo, 'Packages'), packages.stdout)
  files.set('Packages', join(repo, 'Packages'))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const origin = `http://127.0.0.1:${server.address().port}`
  await writeFile(join(root, 'sources.list'), `deb [trusted=yes] ${origin}/ ./\n`)
  const blocked = join(root, 'network-blocked')
  const probe = join(root, 'network-probe.sh')
  await writeFile(probe, `#!/bin/sh\nif curl --noproxy '*' --fail --silent --show-error ${shellQuote(`${origin}/probe`)} > /dev/null; then\n  echo 'Wine fixture: network isolation missing' >&2\n  exit 1\nfi\nprintf denied > ${shellQuote(blocked)}\n`)
  await chmod(probe, 0o755)
  await writeFile(config, `Dir::Etc::parts "-";
Dir::Etc::main "-";
Dir::Etc::sourcelist "${root}/sources.list";
Dir::Etc::sourceparts "-";
Dir::State::lists "${root}/lists";
Dir::State::status "${installed}/var/lib/dpkg/status";
Dir::State::extended_states "${root}/extended";
Dir::Cache::archives "${root}/apt-archives";
Dir::Cache::pkgcache "";
Dir::Cache::srcpkgcache "";
Dir::Log "${root}/log";
Debug::NoLocking "true";
Acquire::Retries "0";
DPkg::Use-Pty "false";
DPkg::Options { "--root=${installed}"; };
DPkg::Pre-Install-Pkgs { "${probe}"; };
`)
  await run('apt-get', ['update'])
  const beforePlan = requests
  await run('bash', [script, 'plan', plan, archives])
  assert.equal(requests, beforePlan, 'Planning contacted the package repository')
  const warmPlan = join(root, 'warm-plan.json')
  await run('unshare', ['--net', 'bash', script, 'plan', warmPlan, archives])
  assert.equal(await readFile(plan, 'utf8'), await readFile(warmPlan, 'utf8'))
  await run('bash', [script, 'download', plan, archives])
  const packagePaths = ['libwine-fixture_1.0_all.deb', 'wine_1.0_all.deb'].map(name => join(archives, name))
  await run('apt-get', ['--yes', '--download-only', '--no-download', '--no-install-recommends', 'install', ...packagePaths], 100)
  const oldInstall = await run('apt-get', ['--yes', '--download-only', '--no-install-recommends', 'install', ...packagePaths])
  assert.equal(oldInstall.split('\n').filter(line => line.startsWith('Get:')).length, 2)
  console.log('wine-cache integration: reproduced 2 repository Get: lines despite local .deb arguments')
  await run('bash', [script, 'verify', plan, archives])
  const beforeInstall = requests
  const installedOutput = await run('bash', [script, 'install', plan, archives])
  assert.equal(requests, beforeInstall, 'Offline installation contacted the package repository')
  assert.ok(installedOutput.includes('Get: lines=0'))
  assert.equal(await readFile(blocked, 'utf8'), 'denied')
  assert.equal(await readFile(join(installed, 'usr/share/wine-fixture/wine'), 'utf8'), 'ready\n')
  console.log('wine-cache integration: real shell install/dpkg passed; network probe denied; Get: lines=0')
  const differentImage = await run('bash', [script, 'verify', plan, archives], 1, { ImageVersion: '2' })
  assert.ok(differentImage.includes('runner image mismatch'))
  const incomplete = join(root, 'incomplete')
  await mkdir(incomplete)
  await copyFile(join(archives, 'wine-plan.json'), join(incomplete, 'wine-plan.json'))
  await copyFile(packagePaths[1], join(incomplete, 'wine_1.0_all.deb'))
  const missingLibrary = await run('bash', [script, 'verify', plan, incomplete], 1)
  assert.ok(missingLibrary.includes('missing archive libwine-fixture'))
  assert.deepEqual(await readFile('/var/lib/dpkg/status'), hostPackageStatus, 'Fixture modified the host package database')
  console.log('wine-cache integration: offline warm planning passed; wrong image and missing library rejected')
} finally {
  if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
  await rm(root, { recursive: true, force: true })
}
