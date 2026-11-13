/** Deterministic public synthetic inputs, independent oracle, and isolated run manifests. */
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const [baseline, candidate, destination] = process.argv.slice(2)
if (!baseline || !candidate) throw new Error('Usage: node scripts/conductor-cost/prepare-world.mjs <baseline-tree> <candidate-tree> [output-parent]')
const variants = [['baseline', resolve(baseline)], ['candidate', resolve(candidate)]].map(([variant, tree]) => {
  const git = (...args) => execFileSync('git', ['-C', tree, ...args], { encoding: 'utf8' }).trim()
  if (git('status', '--porcelain')) throw new Error('Build and commit the runtime tree before preparing a measurement')
  return [variant, tree, git('rev-parse', 'HEAD')]
})

const root = join(destination ? resolve(destination) : tmpdir(), 'dsh-cost-' + randomUUID().slice(0, 12))
const worlds = []
const hash = value => createHash('sha256').update(value).digest('hex')
for (const caseId of ['discovery', 'capture']) {
  const workspace = join(root, caseId)
  await mkdir(join(workspace, '.git'), { recursive: true })
  const files = [], expected = []
  async function file(path, content) {
    await mkdir(join(workspace, path, '..'), { recursive: true })
    await writeFile(join(workspace, path), content)
    files.push({ path: path.replaceAll('\\', '/'), bytes: Buffer.byteLength(content), sha256: hash(content) })
  }
  if (caseId === 'discovery') {
    for (let i = 1; i <= 300; i++) {
      const path = `catalog/group-${Math.floor((i - 1) / 50)}/entry-${String(i).padStart(3, '0')}-${'public-'.repeat(18)}.txt`
      const critical = [2, 151, 299].includes(i)
      const id = critical ? `RISK-${String(i).padStart(3, '0')}` : `OK-${String(i).padStart(3, '0')}`
      await file(path, `# Public synthetic component ${i}\nREVIEW_RECORD id=${id} severity=${critical ? 'CRITICAL' : 'OK'} note=synthetic_catalogue_record\n`)
      if (critical) expected.push({ id, path, line: 2 })
    }
  } else {
    for (const [index, code] of ['alpha', 'beta', 'gamma'].entries()) {
      const path = `archive-${code}.txt`
      const lines = Array.from({ length: 1200 }, (_, i) => `Public record ${String(i + 1).padStart(4, '0')}: synthetic capture filler.`)
      const line = [125, 600, 1100][index]
      const id = `CRITICAL-${code.toUpperCase()}`
      lines[line - 1] = `${id}: synthetic defect requiring review.`
      await file(path, lines.join('\n') + '\n')
      expected.push({ id, path, line })
    }
  }
  const world = { caseId, workspace, files, expected }
  world.worldManifestHash = hash(JSON.stringify({ files, expected }))
  world.task = caseId === 'discovery'
    ? 'Perform a read-only Conductor analysis (purpose=analysis, entry=detective, deliverable=answer, authority.owner="public-benchmark"). Audit the public synthetic text files under catalog/. Identify all records labelled severity=CRITICAL. Report each exact record id, relative file path and one-based source line. Disclose inspection limitations and distinguish workspace observations from admitted captures; discovered files do not gain admitted identities. Acceptance criteria: identify every critical record with its source location; do not invent records or claim uninspected material was read; make no file changes.'
    : 'Perform a read-only Conductor analysis (purpose=analysis, entry=detective, deliverable=answer, authority.owner="public-benchmark", materialFiles=["archive-alpha.txt","archive-beta.txt","archive-gamma.txt"]). Extract every CRITICAL record from the three supplied synthetic captures. Report the exact record id, file selector and one-based line, with precise material_spans against the saved source. Disclose uninspected material. Acceptance criteria: identify all three critical records with exact source locations and valid spans; state that the data is synthetic; make no file changes.'
  worlds.push(world)
}
await writeFile(join(root, 'worlds.json'), JSON.stringify(worlds, null, 2) + '\n')
for (const world of worlds) {
  for (const [variant, tree, expectedHead] of variants) {
    for (let repetition = 0; repetition <= 3; repetition++) {
      const stateRoot = join(root, `${world.caseId}-${variant}-${repetition}`)
      for (const dir of ['home', 'agents', 'profile', 'tmp']) await mkdir(join(stateRoot, dir), { recursive: true })
      const manifest = { caseId: world.caseId, variant, repetition, tree: resolve(tree), expectedHead,
        workspace: world.workspace, stateRoot, task: world.task, worldManifestHash: world.worldManifestHash,
        prepareOnly: repetition === 0, maxMs: 600_000, maxCalls: 64, maxUSD: 0.5 }
      await writeFile(join(stateRoot, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    }
  }
}
process.stdout.write(JSON.stringify({ root, worlds: worlds.map(world => ({ caseId: world.caseId, files: world.files.length,
  bytes: world.files.reduce((sum, file) => sum + file.bytes, 0), expected: world.expected.length, hash: world.worldManifestHash })) }) + '\n')
