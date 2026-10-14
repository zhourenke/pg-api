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

import { useDebouncedFilterChange } from '../use-debounced-filter-change'

/** The delay is the hook's own business; the tests only need one to elapse. */
const DELAY = 1000

/** Typing and time passing both update state, so both must be wrapped. */
function type(
  result: { current: { change: (value: string) => void } },
  value: string
) {
  act(() => result.current.change(value))
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

describe('debounced filter text', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('applies the value only after the delay has passed', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    type(result, 'gemini')
    expect(onChange).not.toHaveBeenCalled()

    advance(DELAY)
    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  it('restarts the delay while the value keeps changing', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    type(result, 'gem')
    advance(DELAY - 100)
    type(result, 'gemini')
    advance(DELAY - 100)

    expect(onChange).not.toHaveBeenCalled()

    advance(100)
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith('gemini')
  })

  it('applies an edit typed after an earlier one has already been applied', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    type(result, 'first')
    advance(DELAY)
    expect(onChange).toHaveBeenLastCalledWith('first')

    type(result, 'second')
    advance(DELAY)
    expect(onChange).toHaveBeenLastCalledWith('second')
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('reports a pending edit and clears it once applied', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    expect(result.current.isPending).toBe(false)
    type(result, 'draft')
    expect(result.current.isPending).toBe(true)

    advance(DELAY)
    expect(result.current.isPending).toBe(false)
  })

  it('applies a pending edit on unmount instead of dropping it', () => {
    const onChange = vi.fn()
    const { result, unmount } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    type(result, 'typed-then-left')
    act(() => unmount())

    expect(onChange).toHaveBeenCalledWith('typed-then-left')
  })

  it('flushes immediately on demand without applying the value twice', () => {
    const onChange = vi.fn()
    const { result } = renderHook(() =>
      useDebouncedFilterChange(onChange, DELAY)
    )

    type(result, 'now')
    act(() => result.current.flush())

    expect(onChange).toHaveBeenCalledWith('now')

    advance(DELAY)
    expect(onChange).toHaveBeenCalledTimes(1)
  })
})
