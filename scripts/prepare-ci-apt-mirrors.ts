/** Prefer an independent Ubuntu archive on ephemeral hosted CI images. */
import { readFileSync, statSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const preferredMirror = 'https://mirrors.edge.kernel.org/ubuntu/\tpriority:0\n'
const downloadConfig = 'Acquire::Retries "1";\nAcquire::http::Timeout "15";\nAcquire::https::Timeout "15";\n'

/**
 * Prepare a hosted image's existing APT mirror list without changing its sources or signing policy.
 * @param aptRoot Absolute APT configuration directory, including a mounted image's etc/apt directory.
 * @param runnerEnvironment GitHub's runner environment; persistent and unknown hosts are refused before writes.
 * @throws When the host is not ephemeral or its APT mirror-list layout is unsupported.
 */
export function prepareCiAptMirrors(aptRoot: string, runnerEnvironment: string | undefined): void {
  if (runnerEnvironment !== 'github-hosted') {
    throw new Error('Refusing to change APT outside a GitHub-hosted ephemeral runner')
  }
  if (!isAbsolute(aptRoot)) throw new Error('APT configuration directory must be an absolute path')

  const sourcePath = join(aptRoot, 'sources.list.d', 'ubuntu.sources')
  const source = readFileSync(sourcePath, 'utf8')
  if (!/^URIs:[\t ]+mirror\+file:\/etc\/apt\/apt-mirrors\.txt[\t ]*$/mu.test(source)) {
    throw new Error(`Unsupported Ubuntu APT layout: ${sourcePath} must use the image's apt-mirrors.txt`)
  }
  const mirrorPath = join(aptRoot, 'apt-mirrors.txt')
  const mirrors = readFileSync(mirrorPath, 'utf8')
  if (mirrors.trim() === '') throw new Error(`Ubuntu APT mirror list is empty: ${mirrorPath}`)
  const configDirectory = join(aptRoot, 'apt.conf.d')
  if (!statSync(configDirectory).isDirectory()) throw new Error(`APT configuration directory is missing: ${configDirectory}`)

  if (!mirrors.startsWith(preferredMirror)) writeFileSync(mirrorPath, preferredMirror + mirrors)
  writeFileSync(join(configDirectory, 'zzzz-dsh-ci-downloads'), downloadConfig)
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && import.meta.url === pathToFileURL(resolve(invokedPath)).href) {
  const aptRoot = process.argv[2]
  if (aptRoot === undefined || process.argv.length !== 3) {
    throw new Error('Usage: prepare-ci-apt-mirrors.ts <absolute APT configuration directory>')
  }
  prepareCiAptMirrors(aptRoot, process.env.RUNNER_ENVIRONMENT)
  console.log('Hosted Ubuntu APT mirror preference and download timeouts configured; sources and signing policy preserved')
}
