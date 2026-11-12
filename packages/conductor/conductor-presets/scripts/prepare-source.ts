/** Source-only preflight, completed before the application's own CLI entry runs. */
import { fileURLToPath } from 'node:url'
import { assertNoLegacyConductorRoot } from './legacy-cli-root.ts'
import { generateConductorSkills } from './prepare-assets.ts'

try {
  await assertNoLegacyConductorRoot(fileURLToPath(new URL('../../../../', import.meta.url)))
  await generateConductorSkills()
} catch (error) {
  await new Promise<void>((resolve) => {
    process.stderr.write(`dsh: could not prepare Conductor skills: ${error instanceof Error ? error.message : String(error)}\n`, () => resolve())
  })
  process.exit(1)
}
