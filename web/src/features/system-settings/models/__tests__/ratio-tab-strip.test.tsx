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
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Tabs } from '@/components/ui/tabs'

import { RatioTabStrip } from '../ratio-tab-strip'

const items = [
  { value: 'models', label: 'Model prices' },
  { value: 'unset-models', label: 'Unset price models' },
]

function Harness() {
  return (
    <Tabs defaultValue='models'>
      <RatioTabStrip items={items} columnsClassName='grid-cols-2' />
    </Tabs>
  )
}

/**
 * jsdom does not lay anything out, so both measurements are always 0 and the
 * drag would look like a no-op. Fixed values keep the production scroll math in
 * play.
 */
function stubStripWidths(scrollWidth: number, clientWidth: number) {
  const strip = screen.getByRole('tablist')
  Object.defineProperty(strip, 'scrollWidth', {
    value: scrollWidth,
    configurable: true,
  })
  Object.defineProperty(strip, 'clientWidth', {
    value: clientWidth,
    configurable: true,
  })
  return strip
}

/** jsdom ships no PointerEvent, and the generic fallback drops `clientX`. */
function stubPointerEvent() {
  class PointerEventStub extends MouseEvent {
    pointerId: number

    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
    }
  }
  window.PointerEvent = PointerEventStub as unknown as typeof PointerEvent
}

function dragStrip(from: number, to: number) {
  const strip = stubStripWidths(600, 300)
  fireEvent.pointerDown(strip, { pointerId: 1, clientX: from })
  fireEvent.pointerMove(strip, { pointerId: 1, clientX: to })
  fireEvent.pointerUp(strip, { pointerId: 1, clientX: to })
  return strip
}

afterEach(() => {
  Reflect.deleteProperty(window, 'PointerEvent')
})

describe('ratio tab strip', () => {
  it('scrolls horizontally instead of squeezing the tabs on narrow viewports', () => {
    render(<Harness />)

    // 宽屏保持固定列宽网格，窄屏改为横向滚动且标签不压缩。
    const strip = screen.getByRole('tablist')
    expect(strip.className).toContain('grid-cols-2')
    expect(strip.className).toContain('max-sm:overflow-x-auto')
    expect(screen.getByRole('tab', { name: 'Unset price models' })).toBeTruthy()
  })

  it('scrolls the strip when the pointer drags it', () => {
    stubPointerEvent()
    render(<Harness />)

    const strip = dragStrip(250, 100)

    expect(strip.scrollLeft).toBe(150)
  })

  it('does not switch tabs when the pointer only dragged the strip', () => {
    stubPointerEvent()
    render(<Harness />)

    dragStrip(250, 100)
    fireEvent.click(screen.getByRole('tab', { name: 'Unset price models' }))

    expect(
      screen
        .getByRole('tab', { name: 'Model prices' })
        .getAttribute('aria-selected')
    ).toBe('true')
  })
})
