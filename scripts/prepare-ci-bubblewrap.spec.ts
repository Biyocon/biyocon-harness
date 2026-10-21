import { spawnSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const script = fileURLToPath(new URL('./prepare-ci-bubblewrap.sh', import.meta.url))
const expectedVersion = '0.9.0-1ubuntu0.3'
const expectedSha256 = '2461f1beee9cb04c8942739fe1a2b37e7b7c2a3d518f0779dc75f9245baa3094'
const expectedUrl = 'https://launchpadlibrarian.net/877343618/bubblewrap_0.9.0-1ubuntu0.3_amd64.deb'
const fixtures: string[] = []

interface RunResult {
  archive: string
  githubPath: string
  log: string[]
  status: number | null
  stderr: string
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { force: true, recursive: true })
})

function shellQuote(value: string): string {
  return `"${value.replace(/["\\$`]/gu, '\\$&')}"`
}

function writeExecutable(path: string, source: string): void {
  writeFileSync(path, source)
  chmodSync(path, 0o755)
}

function shellPath(path: string): string {
  if (process.platform !== 'win32') return path
  const normalized = resolve(path).replaceAll('\\', '/')
  return `/${normalized[0]?.toLowerCase()}${normalized.slice(2)}`
}

function gitBashPath(): string {
  if (process.platform !== 'win32') return 'bash'

  const candidates = [
    process.env.ProgramW6432 === undefined ? undefined : join(process.env.ProgramW6432, 'Git/bin/bash.exe'),
    process.env.ProgramFiles === undefined ? undefined : join(process.env.ProgramFiles, 'Git/bin/bash.exe'),
    process.env['ProgramFiles(x86)'] === undefined ? undefined : join(process.env['ProgramFiles(x86)'], 'Git/bin/bash.exe'),
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Programs/Git/bin/bash.exe'),
  ].filter((candidate): candidate is string => candidate !== undefined)
    .map(candidate => resolve(candidate))
    .filter((candidate, index, all) => all.findIndex(other => other.toLowerCase() === candidate.toLowerCase()) === index)
  const bash = candidates.find(candidate => existsSync(candidate) && statSync(candidate).isFile())
  if (bash === undefined) {
    throw new Error(`Git for Windows Bash is required; tried: ${candidates.join(', ') || '(no candidates)'}`)
  }
  return bash
}

function createFixtureCommand(directory: string, name: string, source: string): void {
  writeExecutable(join(directory, name), `#!/usr/bin/env bash\nset -euo pipefail\n${source}`)
}

function runScript(mode: 'curl-failure' | 'checksum-failure' | 'success'): RunResult {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prepare-ci-bubblewrap-'))
  fixtures.push(root)
  const fakeBin = join(root, 'bin')
  const runnerTemp = join(root, 'runner-temp')
  const githubPath = join(root, 'github-path')
  const logPath = join(root, 'operations.log')
  const bashEnvironment = join(root, 'bash-environment')
  mkdirSync(fakeBin)
  mkdirSync(runnerTemp)
  writeFileSync(githubPath, '')
  writeFileSync(bashEnvironment, `export PATH=${shellQuote(`${shellPath(fakeBin)}:/usr/bin`)}\n`)

  createFixtureCommand(fakeBin, 'uname', `
case "\${1:-}" in
  -s) printf '%s\\n' Linux ;;
  -m) printf '%s\\n' x86_64 ;;
  *) exit 64 ;;
esac
`)
  createFixtureCommand(fakeBin, 'curl', `
printf 'download:%s\\n' "$*" >> "$DSH_TEST_LOG"
${mode === 'curl-failure' ? 'exit 22' : ''}
output=''
while (( $# > 0 )); do
  if [[ "$1" == '--output' ]]; then
    output="$2"
    break
  fi
  shift
done
[[ -n "$output" ]]
/usr/bin/touch "$output"
`)
  createFixtureCommand(fakeBin, 'sha256sum', `
IFS= read -r input
printf 'checksum:%s\\n' "$input" >> "$DSH_TEST_LOG"
${mode === 'checksum-failure' ? 'exit 1' : 'exit 0'}
`)
  createFixtureCommand(fakeBin, 'mkdir', `
printf 'mkdir:%s\\n' "$*" >> "$DSH_TEST_LOG"
/usr/bin/mkdir "$@"
`)
  createFixtureCommand(fakeBin, 'dpkg-deb', `
printf 'extract:%s\\n' "$*" >> "$DSH_TEST_LOG"
root="$3"
/usr/bin/mkdir -p "$root/usr/bin"
cat > "$root/usr/bin/bwrap" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf 'bwrap:%s\\n' "$*" >> "$DSH_TEST_LOG"
EOF
chmod +x "$root/usr/bin/bwrap"
`)
  createFixtureCommand(fakeBin, 'sudo', `
printf 'sysctl:%s\\n' "$*" >> "$DSH_TEST_LOG"
`)

  const result = spawnSync(gitBashPath(), ['--noprofile', '--norc', shellPath(script)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      BASH_ENV: shellPath(bashEnvironment),
      DSH_TEST_LOG: shellPath(logPath),
      GITHUB_PATH: shellPath(githubPath),
      PATH: process.platform === 'win32'
        ? `${shellPath(fakeBin)}:/usr/bin`
        : `${fakeBin}${delimiter}${process.env.PATH ?? ''}`,
      RUNNER_TEMP: shellPath(runnerTemp),
    },
  })
  return {
    archive: shellPath(join(runnerTemp, `bubblewrap_${expectedVersion}_amd64.deb`)),
    githubPath: readFileSync(githubPath, 'utf8'),
    log: existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n') : [],
    status: result.status,
    stderr: result.stderr,
  }
}

function expectedDownloadLog(archive: string): string {
  return `download:--fail --silent --show-error --location --retry 3 --retry-all-errors --output ${archive} ${expectedUrl}`
}

describe('prepare-ci-bubblewrap', () => {
  it('stops after a curl exit 22', () => {
    const result = runScript('curl-failure')

    expect(result.status).toBe(22)
    expect(result.log).toHaveLength(1)
    expect(result.log[0]).toBe(expectedDownloadLog(result.archive))
    expect(result.githubPath).toBe('')
  })

  it('stops after a checksum failure', () => {
    const result = runScript('checksum-failure')

    expect(result.status).toBe(1)
    expect(result.log).toHaveLength(2)
    expect(result.log[0]).toBe(expectedDownloadLog(result.archive))
    expect(result.log[1]).toBe(`checksum:${expectedSha256}  ${result.archive}`)
    expect(result.githubPath).toBe('')
  })

  it('pins the verified artifact and preserves preparation order', () => {
    const result = runScript('success')
    const source = readFileSync(script, 'utf8')

    expect(result.status, result.stderr).toBe(0)
    expect(result.log).toHaveLength(7)
    expect(result.log[0]).toBe(expectedDownloadLog(result.archive))
    expect(result.log[1]).toContain(`checksum:${expectedSha256}  `)
    expect(result.log[2]).toContain('mkdir:-p')
    expect(result.log[3]).toContain('extract:--extract')
    expect(result.githubPath).toMatch(/dsh-bubblewrap[/\\]usr[/\\]bin\r?\n/u)
    expect(result.log[4]).toBe('sysctl:sysctl -w kernel.apparmor_restrict_unprivileged_userns=0')
    expect(result.log[5]).toBe('bwrap:--version')
    expect(result.log[6]).toBe('bwrap:--ro-bind / / --dev /dev --proc /proc --die-with-parent -- true')

    const orderedSourceFragments = [
      'curl --fail',
      'sha256sum --check --status',
      'mkdir -p "$root"',
      'dpkg-deb --extract',
      '>> "$GITHUB_PATH"',
      'sudo sysctl',
      '"$root/usr/bin/bwrap" --version',
      '"$root/usr/bin/bwrap" --ro-bind',
    ]
    const positions = orderedSourceFragments.map(fragment => source.indexOf(fragment))
    expect(positions.every(position => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })
})
