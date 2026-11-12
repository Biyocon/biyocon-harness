import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { sourceLaunchFixture } from './fixtures/source-launch-fixture.ts'
import { assertNoLegacyConductorRoot } from '../../../packages/conductor/conductor-presets/scripts/legacy-cli-root.ts'

it.each(['preset.yml', 'agent.cordis.yml', 'custom.txt', 'skills/custom.txt'])(
  'leaves a non-legacy tree with %s to ordinary preset validation', async (extra) => {
    const fixture = await sourceLaunchFixture()
    try {
      const legacy = await fixture.seedLegacy()
      await writeFile(join(legacy, extra), 'synthetic custom content')
      await expect(assertNoLegacyConductorRoot(fixture.checkout)).resolves.toBeUndefined()
    } finally {
      await fixture.dispose()
    }
  },
)
