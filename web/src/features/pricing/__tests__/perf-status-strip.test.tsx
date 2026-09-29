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
import { act, fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, describe, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'

import { ModelPerfStatusStrip } from '../components/model-perf-status-strip'

const HOUR = 3600

// 00:00 local time of a fixed day keeps the expected hour labels deterministic.
const dayStart = Math.floor(new Date(2026, 8, 28, 0, 0, 0, 0).getTime() / 1000)

function stubStripRect(width: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    left: 100,
    right: 100 + width,
    top: 0,
    bottom: 12,
    width,
    height: 12,
    x: 100,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect)
}

function stripElement(): HTMLElement {
  // The accessible name follows the active locale, so locate the strip by role.
  return screen.getByRole('img')
}

function slotElements(): HTMLElement[] {
  return [...stripElement().children] as HTMLElement[]
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('ModelPerfStatusStrip', () => {
  it('renders 24 hourly slots and greys out the hours without samples', () => {
    render(
      <ModelPerfStatusStrip
        windowStart={dayStart}
        series={[{ ts: dayStart + 5 * HOUR, success_rate: 98.22 }]}
      />
    )

    const slots = slotElements()
    expect(slots).toHaveLength(24)
    expect(slots[5].className).not.toContain('bg-muted-foreground/15')
    expect(slots[4].className).toContain('bg-muted-foreground/15')
  })

  it('resolves the nearest hour when the pointer lands between two bars', () => {
    stubStripRect(96)
    render(
      <ModelPerfStatusStrip
        windowStart={dayStart}
        series={[{ ts: dayStart + 5 * HOUR, success_rate: 98.22 }]}
      />
    )

    // 24 slots over 96px: x = 100 + 5 whole slots + 2px is inside slot 5.
    fireEvent.pointerMove(stripElement(), { clientX: 122 })

    expect(screen.getByRole('tooltip')).toHaveTextContent('Hour 05: 98.22%')
  })

  it('reports missing hours instead of a rate when the slot has no samples', () => {
    stubStripRect(96)
    render(<ModelPerfStatusStrip windowStart={dayStart} />)

    fireEvent.pointerMove(stripElement(), { clientX: 100 + 8 * 4 + 1 })

    expect(screen.getByRole('tooltip')).toHaveTextContent(
      'Hour 08: No data available'
    )
  })

  it('shows the shipped Chinese tooltip copy', () => {
    act(() => {
      i18n.addResourceBundle(
        'zhCN',
        'translation',
        zhCN.translation,
        true,
        true
      )
    })
    stubStripRect(96)
    render(
      <ModelPerfStatusStrip
        windowStart={dayStart}
        series={[{ ts: dayStart + 21 * HOUR, success_rate: 98.22 }]}
      />
    )

    fireEvent.pointerMove(stripElement(), { clientX: 100 + 21 * 4 + 1 })

    expect(screen.getByRole('tooltip')).toHaveTextContent('21 时 98.22%')
  })

  it('keeps the tooltip after a touch tap until the user taps elsewhere', () => {
    stubStripRect(96)
    render(
      <ModelPerfStatusStrip
        windowStart={dayStart}
        series={[{ ts: dayStart + 5 * HOUR, success_rate: 98.22 }]}
      />
    )

    fireEvent.pointerDown(stripElement(), {
      clientX: 122,
      pointerType: 'touch',
    })
    expect(screen.getByRole('tooltip')).toBeVisible()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('hides the tooltip when the cursor leaves the strip', () => {
    stubStripRect(96)
    render(
      <ModelPerfStatusStrip
        windowStart={dayStart}
        series={[{ ts: dayStart + 5 * HOUR, success_rate: 98.22 }]}
      />
    )

    fireEvent.pointerMove(stripElement(), {
      clientX: 122,
      pointerType: 'mouse',
    })
    expect(screen.getByRole('tooltip')).toBeVisible()

    fireEvent.pointerLeave(stripElement(), { pointerType: 'mouse' })
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
  })

  it('sizes every slot on whole pixels once the strip is measured', () => {
    class ImmediateResizeObserver {
      callback: ResizeObserverCallback

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback
      }

      observe(target: Element) {
        this.callback(
          [
            {
              target,
              contentRect: { width: 96 } as DOMRectReadOnly,
            } as ResizeObserverEntry,
          ],
          this as unknown as ResizeObserver
        )
      }

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal('ResizeObserver', ImmediateResizeObserver)

    render(<ModelPerfStatusStrip windowStart={dayStart} />)

    const widths = slotElements().map((slot) => slot.style.width)
    expect(widths[0]).toBe('4px')
    expect(widths.slice(1).every((width) => width === '3px')).toBe(true)
    const total =
      widths.reduce((sum, width) => sum + Number.parseInt(width, 10), 0) + 23
    expect(total).toBe(96)
  })
})
