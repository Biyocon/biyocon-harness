/** Content-free report CLI for an explicitly selected synthetic measurement root. */
import { readFile, writeFile, realpath, readdir } from 'node:fs/promises'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { aggregateCostTrials, analyzeCostTrial } from '../conductor-cost-report.ts'

const rootArg = process.argv[2]
if (rootArg === undefined) throw new Error('Usage: pnpm run measure:conductor:report <synthetic-root>')
const root = await realpath(rootArg)
const worlds = z.array(z.looseObject({ caseId: z.enum(['capture', 'discovery']), workspace: z.string(),
  files: z.array(z.looseObject({ path: z.string(), sha256: z.string() })),
})).parse(JSON.parse(await readFile(join(root, 'worlds.json'), 'utf8')) as unknown)
const contained = (path: string): boolean => {
  const suffix = relative(root, path)
  return suffix !== '' && !isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith('..\\') && !suffix.startsWith('../')
}
const trials: Array<ReturnType<typeof analyzeCostTrial>> = []
const pending: string[] = []
for (const world of worlds) {
  const workspace = await realpath(world.workspace)
  if (!contained(workspace)) throw new Error('Synthetic workspace is outside the selected root')
  let unchanged = true
  const actualFiles = (await readdir(workspace, { recursive: true, withFileTypes: true }))
    .filter(entry => entry.isFile()).map(entry => relative(workspace, join(entry.parentPath, entry.name)).replaceAll('\\', '/')).sort()
  if (JSON.stringify(actualFiles) !== JSON.stringify(world.files.map(file => file.path).sort())) unchanged = false
  for (const file of world.files) {
    const path = await realpath(resolve(workspace, file.path))
    if (!contained(path) || !path.startsWith(workspace + (process.platform === 'win32' ? '\\' : '/'))) {
      throw new Error('Synthetic source is outside its workspace')
    }
    if (createHash('sha256').update(await readFile(path)).digest('hex') !== file.sha256) unchanged = false
  }
  for (const variant of ['baseline', 'candidate']) for (const repetition of [1, 2, 3]) {
    const id = `${world.caseId}-${variant}-${repetition}`
    const state = join(root, id)
    let text: string
    try { text = await readFile(join(state, 'raw.json'), 'utf8') } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error
      try { text = await readFile(join(state, 'raw-incomplete.json'), 'utf8') } catch (incompleteError) {
        if (!(incompleteError instanceof Error) || !('code' in incompleteError) || incompleteError.code !== 'ENOENT') throw incompleteError
        pending.push(id)
        continue
      }
    }
    const report = analyzeCostTrial(JSON.parse(text) as unknown, world, unchanged)
    trials.push(report)
    await writeFile(join(state, 'analysis.json'), JSON.stringify(report, null, 2) + '\n')
  }
}
const output = { pricingChecked: '2026-11-11', pricingSource: 'https://api-docs.deepseek.com/quick_start/pricing/',
  ratesUSDPerMillion: { uncachedInput: 0.15, cacheRead: 0.003, outputIncludingReasoning: 0.60 },
  priceKind: 'standard off-peak equivalent; not an invoice or account debit',
  qualityScope: 'known critical IDs, one-line report locations, observed source exposure and saved spans; not semantic truth certification',
  pending, ...aggregateCostTrials(trials), trials }
await writeFile(join(root, 'report.json'), JSON.stringify(output, null, 2) + '\n')
process.stdout.write(JSON.stringify({ ...output, trials: trials.length }) + '\n')
