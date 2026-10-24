// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { DropOverlay } from '../src/DropOverlay.tsx'

afterEach(cleanup)

describe('DropOverlay', () => {
  it('portals the invitation with its title and limits desc to the body', () => {
    const view = render(
      <DropOverlay disabled={false} labels={{ title: 'Træk billeder hertil for at tilføje dem', desc: 'Op til 20 billeder, 5MB pr. billede' }} />,
    )
    const overlay = view.getByRole('status')
    expect(overlay.parentElement).toBe(document.body)
    expect(overlay.textContent).toContain('Træk billeder hertil for at tilføje dem')
    expect(overlay.textContent).toContain('Op til 20 billeder, 5MB pr. billede')
  })

  it('omits the desc line when none is resolved', () => {
    const view = render(<DropOverlay disabled={false} labels={{ title: 'Træk billeder hertil for at tilføje dem' }} />)
    expect(view.getByRole('status').textContent).toBe('Træk billeder hertil for at tilføje dem')
  })

  it('drops the desc and switches the illustration while disabled', () => {
    const enabled = render(
      <DropOverlay disabled={false} labels={{ title: '拖入', desc: '限制' }} />,
    )
    const enabledSvg = enabled.getByRole('status').querySelector('svg')!.innerHTML
    enabled.unmount()
    const disabled = render(
      <DropOverlay disabled labels={{ title: 'Billeder kan ikke tilføjes lige nu', desc: '限制' }} />,
    )
    const overlay = disabled.getByRole('status')
    expect(overlay.textContent).toBe('Billeder kan ikke tilføjes lige nu')
    expect(overlay.querySelector('svg')!.innerHTML).not.toBe(enabledSvg)
  })
})
