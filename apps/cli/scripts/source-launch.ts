#!/usr/bin/env node
/** Source-only preparation; the published CLI never imports repository tooling. */
import { generateConductorSkills } from './generate-conductor-skills.ts'

try {
  await generateConductorSkills()
} catch (error) {
  process.stderr.write(`dsh: could not prepare Conductor skills: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
}

await import('../src/bin.ts')
