import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join } from 'node:path'

const observation = process.env.DSH_TEST_LOCK_RELEASE_OBSERVATION
const unlink = fs.unlinkSync
fs.unlinkSync = (path) => {
  if (observation !== undefined && typeof path === 'string'
    && basename(path).startsWith('dsh-lefthook-install.lock')) {
    fs.writeFileSync(observation, JSON.stringify({
      path,
      sharedExists: fs.existsSync(join(dirname(path), 'dsh-lefthook-install.lock')),
    }))
  }
  return unlink(path)
}
syncBuiltinESMExports()
