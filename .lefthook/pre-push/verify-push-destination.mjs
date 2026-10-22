#!/usr/bin/env node
/**
 * Fails closed unless a named Git remote resolves to the Biyocon fork.
 */

import { pathToFileURL } from 'node:url'

export const ALLOWED_PUSH_REPOSITORY = 'biyocon/deepseek-harness'

function normalizedRepositoryPath(pathname) {
  if (pathname.includes('%') || pathname.includes('\\')) return undefined
  const withoutLeadingSlash = pathname.startsWith('/') ? pathname.slice(1) : pathname
  const withoutTrailingSlash = withoutLeadingSlash.endsWith('/')
    ? withoutLeadingSlash.slice(0, -1)
    : withoutLeadingSlash
  const segments = withoutTrailingSlash.split('/')
  if (segments.length !== 2 || segments.some(segment => segment === '')) return undefined
  const repository = segments[1].replace(/\.git$/iu, '')
  if (repository === '') return undefined
  return `${segments[0]}/${repository}`.toLowerCase()
}

function normalizeScpLocation(location) {
  const match = /^git@github\.com:([^/?#\\]+)\/([^/?#\\]+?)(?:\.git)?\/?$/iu.exec(location)
  if (match === null) return undefined
  return `${match[1]}/${match[2]}`.toLowerCase()
}

function normalizeUrlLocation(location) {
  // Git distinguishes URL authorities from SCP syntax; browser URL repair is unsafe here.
  const match = /^(?:https:\/\/github\.com|ssh:\/\/git@github\.com)(\/[^?#\\]+)$/iu.exec(location)
  if (match === null) return undefined
  return normalizedRepositoryPath(match[1])
}

/**
 * Resolves an unambiguous GitHub HTTPS or SSH location to `owner/repository`.
 *
 * @param {string} location Git's pre-push remote-location argument.
 * @returns {string | undefined} The normalized lowercase repository identity.
 */
export function normalizePushRepository(location) {
  if (
    typeof location !== 'string'
    || location === ''
    || /[\u0000-\u001f\u007f]/u.test(location)
    || location.trim() !== location
  ) {
    return undefined
  }
  return normalizeScpLocation(location) ?? normalizeUrlLocation(location)
}

/**
 * Validates Git's two pre-push arguments and returns the allowed repository.
 *
 * @param {readonly string[]} args Git's remote-name and remote-location arguments.
 * @returns {{ readonly remoteName: string, readonly repository: string }} Validated destination data.
 * @throws {Error} When the invocation is direct, incomplete, ambiguous, or targets another repository.
 */
export function validatePushDestination(args) {
  if (args.length !== 2 || args.some(argument => argument === '')) {
    throw new Error('expected Git pre-push arguments: <remote-name> <remote-location>')
  }
  const [remoteName, remoteLocation] = args
  if (remoteName === remoteLocation) {
    throw new Error('direct URL pushes are not allowed; use a named remote for the Biyocon fork')
  }
  const repository = normalizePushRepository(remoteLocation)
  if (repository === undefined) {
    throw new Error(`push destination is not an unambiguous GitHub HTTPS or SSH repository: ${JSON.stringify(remoteLocation)}`)
  }
  if (repository !== ALLOWED_PUSH_REPOSITORY) {
    throw new Error(
      `push destination ${JSON.stringify(repository)} is not allowed; expected ${JSON.stringify(ALLOWED_PUSH_REPOSITORY)}`,
    )
  }
  return { remoteName, repository }
}

function main() {
  try {
    validatePushDestination(process.argv.slice(2))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[verify-push-destination] ${message}`)
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main()
