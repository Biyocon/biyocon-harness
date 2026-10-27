import fs from 'node:fs/promises'
import { syncBuiltinESMExports } from 'node:module'
import { basename, dirname, join } from 'node:path'

const write = fs.writeFile
fs.writeFile = async (path, data, options) => {
  if (typeof path !== 'string' || !/^tree\.json(?:\..+\.tmp)?$/.test(basename(path))
    || typeof data !== 'string') return write(path, data, options)
  await write(path, data.slice(0, 1), options)
  await write(join(dirname(path), 'state-writing'), JSON.stringify({ path, data }))
  for (;;) {
    try {
      await fs.access(join(dirname(path), 'state-continue'))
      break
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  return write(path, data.slice(1), { flag: 'a' })
}
syncBuiltinESMExports()
