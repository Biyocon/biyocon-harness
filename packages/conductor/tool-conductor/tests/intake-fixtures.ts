import { SessionId } from '@deepseek-ai/dsh-session'
import { admitIntake, captureIntakeMaterial } from '@deepseek-ai/dsh-conductor'

export function toolAdmission() {
  return admitIntake({ purpose: 'implementation', entry: 'detective', rationale: 'Explicit implementation test mandate.' }, [
    captureIntakeMaterial('current-request', 'Repair Conductor CI.', { sessionId: SessionId('tool-test-parent'), eventIndex: 1 }),
  ])
}
