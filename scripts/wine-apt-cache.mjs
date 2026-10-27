/** Content-verified Wine apt archives shared by the seed and offline CI jobs. */
import { createHash } from 'node:crypto'
import { appendFileSync, lstatSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const digest = bytes => createHash('sha256').update(bytes).digest('hex')
const archiveName = /^[a-zA-Z0-9.+:~%_-]+\.deb$/

function archiveUri(value) {
  const mirror = /^mirror\+file:\/etc\/apt\/apt-mirrors(-security)?\.txt(\/pool\/.+)$/.exec(value)
  const url = mirror
    ? new URL(`https://${mirror[1] ? 'security' : 'archive'}.ubuntu.com/ubuntu${mirror[2]}`)
    : new URL(value)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('wine-cache: archive URI must be HTTP(S) without credentials')
  }
  if (['azure.archive.ubuntu.com', 'archive.ubuntu.com', 'security.ubuntu.com'].includes(url.hostname)) {
    if (url.hostname === 'azure.archive.ubuntu.com') url.hostname = 'archive.ubuntu.com'
    url.protocol = 'https:'
  }
  return url.href
}

function readPlan(path) {
  const plan = JSON.parse(readFileSync(path, 'utf8'))
  if (plan?.format !== 2 || typeof plan.wineVersion !== 'string'
    || !/^[0-9][a-zA-Z0-9.+:~_-]*$/.test(plan.wineVersion)
    || typeof plan.runnerImage !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(plan.runnerImage)
    || !Array.isArray(plan.archives) || plan.archives.length === 0) {
    throw new Error('wine-cache: invalid archive plan')
  }
  const names = new Set()
  for (const entry of plan.archives) {
    if (!entry || typeof entry.name !== 'string' || !archiveName.test(entry.name)
      || !Number.isSafeInteger(entry.size) || entry.size <= 0
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)
      || typeof entry.uri !== 'string' || archiveUri(entry.uri) !== entry.uri
      || names.has(entry.name)) {
      throw new Error('wine-cache: invalid or duplicate archive entry')
    }
    names.add(entry.name)
  }
  return plan
}

function cacheKey(plan) {
  return `wine-debs-v3-${plan.runnerImage}-${plan.wineVersion}-${digest(JSON.stringify(plan))}`
}

function makePlan(logPath, wineVersion, runnerImage, outputPath) {
  const archives = []
  for (const line of readFileSync(logPath, 'utf8').split(/\r?\n/)) {
    if (!line.startsWith("'")) continue
    const match = /^'([^']+)' (\S+) (\d+) SHA256:([a-f0-9]{64})$/.exec(line)
    if (!match) throw new Error(`wine-cache: apt did not provide a SHA256 archive record: ${line}`)
    archives.push({ name: match[2], size: Number(match[3]), sha256: match[4], uri: archiveUri(match[1]) })
  }
  archives.sort((left, right) => left.name.localeCompare(right.name, 'en'))
  writeFileSync(outputPath, `${JSON.stringify({ format: 2, wineVersion, runnerImage, archives }, null, 2)}\n`)
  const plan = readPlan(outputPath)
  const key = cacheKey(plan)
  console.log(`wine-cache: planned ${plan.archives.length} archives, Wine ${plan.wineVersion}, key ${key}`)
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `key=${key}\n`)
}

function validate(planPath, directory, expectedImage, expectedKey) {
  const plan = readPlan(planPath)
  if (plan.runnerImage !== expectedImage) throw new Error(`wine-cache: runner image mismatch: expected ${expectedImage}, got ${plan.runnerImage}`)
  if (expectedKey && cacheKey(plan) !== expectedKey) throw new Error('wine-cache: restored plan does not match the requested key')
  if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) {
    throw new Error('wine-cache: archive directory must be a real directory')
  }
  const storedPlan = readPlan(join(directory, 'wine-plan.json'))
  if (JSON.stringify(storedPlan) !== JSON.stringify(plan)) throw new Error('wine-cache: stored plan differs from the current apt plan')
  const expectedNames = new Set(plan.archives.map(entry => entry.name))
  const unexpected = readdirSync(directory).filter(name => name.endsWith('.deb') && !expectedNames.has(name))
  if (unexpected.length) throw new Error(`wine-cache: unexpected archives: ${unexpected.join(', ')}`)
  let total = 0
  for (const entry of plan.archives) {
    const path = join(directory, entry.name)
    let stat
    try {
      stat = lstatSync(path)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      throw new Error(`wine-cache: missing archive ${entry.name}`)
    }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`wine-cache: archive is not a regular file: ${entry.name}`)
    if (stat.size !== entry.size) throw new Error(`wine-cache: size mismatch for ${entry.name}: expected ${entry.size}, got ${stat.size}`)
    if (digest(readFileSync(path)) !== entry.sha256) throw new Error(`wine-cache: SHA256 mismatch for ${entry.name}`)
    total += stat.size
    console.log(`wine-cache: verified ${entry.name} bytes=${stat.size} sha256=${entry.sha256}`)
  }
  console.log(`wine-cache: complete collection: ${plan.archives.length} archives, ${total} bytes`)
}

function verifyOfflineLog(path) {
  const downloads = readFileSync(path, 'utf8').split(/\r?\n/).filter(line => /^Get:/.test(line))
  if (downloads.length) throw new Error(`wine-cache: offline apt unexpectedly acquired archives: ${downloads.join('; ')}`)
  console.log('wine-cache: offline apt completed; Get: lines=0')
}

const [command, ...args] = process.argv.slice(2)
try {
  switch (command) {
    case 'plan':
      if (args.length !== 4) throw new Error('wine-cache: plan requires apt log, Wine version, image id and output path')
      makePlan(...args)
      break
    case 'validate':
      if (args.length < 3 || args.length > 4) throw new Error('wine-cache: validate requires plan, archive directory, runner image and optional expected key')
      validate(...args)
      break
    case 'version':
      if (args.length !== 1) throw new Error('wine-cache: version requires a plan')
      console.log(readPlan(args[0]).wineVersion)
      break
    case 'downloads':
      if (args.length !== 1) throw new Error('wine-cache: downloads requires a plan')
      for (const entry of readPlan(args[0]).archives) console.log(`${entry.uri}\t${entry.name}`)
      break
    case 'offline-log':
      if (args.length !== 1) throw new Error('wine-cache: offline-log requires an apt log')
      verifyOfflineLog(resolve(args[0]))
      break
    default:
      throw new Error(`wine-cache: unknown command ${command ?? '(missing)'}`)
  }
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
