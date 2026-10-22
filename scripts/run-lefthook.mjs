#!/usr/bin/env node
/** Runs Lefthook without inserting Git's destination arguments into shell commands. */

import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import lefthookPackage from 'lefthook/package.json' with { type: 'json' }

const TRANSPORT_KEY = 'DSH_GIT_PRE_PUSH_ARGS'
const args = process.argv.slice(2)
const env = { ...process.env }
for (const key of Object.keys(env)) {
  if (key.toUpperCase() === TRANSPORT_KEY) delete env[key]
}
const isPrePush = args[0] === 'run' && args[1] === 'pre-push'
if (isPrePush) env[TRANSPORT_KEY] = JSON.stringify(args.slice(2))

const packageDirectory = dirname(fileURLToPath(import.meta.resolve('lefthook/package.json')))
const entrypoint = resolve(packageDirectory, lefthookPackage.bin.lefthook)
const result = spawnSync(process.execPath, [entrypoint, ...(isPrePush ? ['run', 'pre-push'] : args)], {
  env,
  stdio: 'inherit',
})
if (result.error !== undefined) console.error(`[run-lefthook] ${result.error.message}`)
process.exitCode = result.status ?? 1
