import type { Context } from '@deepseek-ai/cordis'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'

export const inject = ['approval']

/** Provide the host-owned one-shot Gate-C decision for the assembled snapshot. */
export function apply(ctx: Context): void {
  ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
}
