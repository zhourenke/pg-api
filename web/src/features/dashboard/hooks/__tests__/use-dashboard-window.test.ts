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
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveTimeWindow } from '@/lib/time-window'

import { useDashboardWindow } from '../use-dashboard-window'

const BEFORE_MIDNIGHT = new Date(2026, 7, 12, 23, 59)
const AFTER_MIDNIGHT = new Date(2026, 7, 13, 0, 5)

function bringTabBackToForeground() {
  Object.defineProperty(document, 'visibilityState', {
    value: 'visible',
    configurable: true,
  })
  document.dispatchEvent(new Event('visibilitychange'))
}

describe('dashboard window', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(BEFORE_MIDNIGHT)
  })

  afterEach(() => {
    vi.useRealTimers()
    Reflect.deleteProperty(document, 'visibilityState')
  })

  it('keeps the resolved window between renders', () => {
    const { result, rerender } = renderHook(() =>
      useDashboardWindow({ preset: '7d' })
    )
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })

  it('re-resolves a calendar window once the tab becomes visible again', () => {
    const { result } = renderHook(() => useDashboardWindow({ preset: 'today' }))
    const before = result.current
    expect(before).toEqual(resolveTimeWindow('today', BEFORE_MIDNIGHT))

    // Local midnight passes while the dashboard sits in a background tab. The
    // window is still the stale one, because nothing has asked for it again.
    vi.setSystemTime(AFTER_MIDNIGHT)
    expect(result.current).toEqual(before)

    act(() => bringTabBackToForeground())

    expect(result.current).toEqual(resolveTimeWindow('today', AFTER_MIDNIGHT))
    expect(result.current.start).toBeGreaterThan(before.start)
  })
})
