import { defineConfig } from 'tsdown'
import { generateConductorSkills } from '../conductor-presets/scripts/prepare-assets.ts'

/** Package-owned generation of the rc.7 host bundle's installed resources. */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'], outDir: 'lib', format: ['esm'],
  platform: 'node', target: 'es2024', fixedExtension: false, dts: false, clean: false,
  onSuccess: generateConductorSkills,
})
