export const ALLOWED_PUSH_REPOSITORY: 'biyocon/deepseek-harness'

export interface ValidatedPushDestination {
  readonly remoteName: string
  readonly repository: string
}

/**
 * Resolves an unambiguous GitHub HTTPS or SSH location to `owner/repository`.
 *
 * @param location Git's pre-push remote-location argument.
 * @returns The normalized lowercase repository identity.
 */
export function normalizePushRepository(location: string): string | undefined

/**
 * Validates Git's two pre-push arguments and returns the allowed repository.
 *
 * @param args Git's remote-name and remote-location arguments.
 * @returns Validated destination data.
 * @throws When the invocation is direct, incomplete, ambiguous, or targets another repository.
 */
export function validatePushDestination(args: readonly string[]): ValidatedPushDestination
