import { describe, it, expect } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor/types'
import type { ConductorChild } from '@deepseek-ai/dsh-conductor/child-types'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { conductorChildPresentation } from '../src/client/presentation.ts'
import { da, en } from '../src/client/locales.ts'
const CHILD='child' as SessionId
it.each(['pass', 'escalate', 'abort'] as const)('presents a failed Ralph worker and the %s gate as text', (decision) => {
  const child: ConductorChild = { childId: CHILD, runId: ConductorRunId('CON-2026-0028'), role: 'ralph',
    attempt: 2, historyOffset: 1, status: 'failed', gate: { id: 'D', decision, reworks: 0, limit: 2 } }
  expect(conductorChildPresentation(child, makeTranslate(da))).toEqual({ label: 'Ralph-arbejder · forsøg 2',
    detail: `fejlet · Gate D: ${decision === 'pass' ? 'bestået' : decision === 'abort' ? 'afbrudt' : 'eskaleret'}` })
})

describe('exact-child locale presentation',()=>{
  it.each([da,en])('keeps a fresh attempt free of the previous verdict',(dictionary)=>{
    const child: ConductorChild={ childId:CHILD,runId:ConductorRunId('CON-2026-0028'),role:'strategist',attempt:1,historyOffset:1,status:'completed',gate:{ id:'B',decision:'rework',reworks:1,limit:2 } }
    const next: ConductorChild={ ...child,childId:'next' as SessionId,attempt:2,status:'running' };delete next.gate
    const t=makeTranslate(dictionary)
    expect(conductorChildPresentation(child,t).detail).toContain('Gate B: rework 1/2')
    expect(conductorChildPresentation(next,t).detail).not.toContain('Gate')
    expect(conductorChildPresentation(next,t).label).toContain('2')
  })
})
