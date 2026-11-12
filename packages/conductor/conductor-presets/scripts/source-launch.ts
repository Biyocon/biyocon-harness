#!/usr/bin/env node
/** Package-owned source preparation; installed hosts use the packed resources. */
import { generateConductorSkills } from './prepare-assets.ts'

try {
  await generateConductorSkills()
} catch (error) {
  process.stderr.write(`dsh: could not prepare Conductor skills: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
if (process.exitCode !== 1) await import('../../../../apps/cli/scripts/source-launch.ts')
