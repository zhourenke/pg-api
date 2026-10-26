/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { fireEvent, render } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import { TOUCH_TOOLTIP_SPEC, useTouchTooltipHold } from '@/lib/chart-touch'

function Host() {
  const hostRef = useRef<HTMLDivElement>(null)
  useTouchTooltipHold(hostRef)
  return <div ref={hostRef} data-testid='host' />
}

/**
 * What VChart actually puts inside the host: a canvas with its own native
 * `pointerleave` listener, not a React handler. Only a native listener shows
 * whether the capture-phase guard really stops the event.
 */
function mountCanvas(host: HTMLElement): {
  canvas: HTMLDivElement
  reached: Array<string | undefined>
} {
  const canvas = document.createElement('div')
  host.appendChild(canvas)
  const reached: Array<string | undefined> = []
  canvas.addEventListener('pointerleave', (event) => {
    reached.push((event as PointerEvent).pointerType)
  })
  return { canvas, reached }
}

describe('TOUCH_TOOLTIP_SPEC', () => {
  it('opens the tooltip on a tap as well as on a hover', () => {
    // `desktop-browser` mode defines the tooltip's own hover as pointermove,
    // which a stationary tap never emits.
    expect(TOUCH_TOOLTIP_SPEC.trigger).toEqual(['hover', 'click'])
  })

  it('keeps the panel out of the pointer path so a tap reads through it', () => {
    expect(TOUCH_TOOLTIP_SPEC.enterable).toBe(false)
  })
})

describe('useTouchTooltipHold', () => {
  it('swallows the pointerleave a raised finger emits', () => {
    const { getByTestId } = render(<Host />)
    const { canvas, reached } = mountCanvas(getByTestId('host'))

    // For a pointer that never hovers the spec fires pointerleave right after
    // pointerup; letting it through closed the tooltip the moment the finger
    // lifted.
    fireEvent.pointerLeave(canvas, { pointerType: 'touch' })
    expect(reached).toEqual([])
  })

  it('still lets a mouse leaving the plot end the selection', () => {
    const { getByTestId } = render(<Host />)
    const { canvas, reached } = mountCanvas(getByTestId('host'))

    fireEvent.pointerLeave(canvas, { pointerType: 'mouse' })
    expect(reached).toEqual(['mouse'])
  })
})
