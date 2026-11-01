#!/usr/bin/env node
/** Source-only preparation; the published CLI never imports repository tooling. */
import { generateConductorSkills } from './generate-conductor-skills.ts'

let preparationFailed = false
try {
  await generateConductorSkills()
} catch (error) {
  process.stderr.write(`dsh: could not prepare Conductor skills: ${error instanceof Error ? error.message : String(error)}\n`)
  preparationFailed = true
  process.exitCode = 1
}

if (!preparationFailed) await import('../src/bin.ts')
