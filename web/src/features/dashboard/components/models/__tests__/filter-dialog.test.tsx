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
import userEvent from '@testing-library/user-event'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import type { DashboardFilters } from '@/features/dashboard/types'
import { resolveTimeWindow, TIME_WINDOW_PRESETS } from '@/lib/time-window'

import { ModelsFilter } from '../models-filter-dialog'

/** Wednesday midweek, so "this week" is Monday the 10th to Sunday the 16th. */
const NOW = new Date(2026, 7, 12, 10, 30)

// jsdom has no Element.getAnimations, which the scroll area inside the dialog
// calls to finish its scroll animation; without it the teardown throws.
const originalGetAnimations = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'getAnimations'
)

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'getAnimations', {
    configurable: true,
    value: () => [],
  })
})

afterAll(() => {
  if (originalGetAnimations) {
    Object.defineProperty(
      HTMLElement.prototype,
      'getAnimations',
      originalGetAnimations
    )
    return
  }
  Reflect.deleteProperty(HTMLElement.prototype, 'getAnimations')
})

function localDate(seconds: number): string {
  const date = new Date(seconds * 1000)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function renderDialog(filters: DashboardFilters) {
  const onFilterChange = vi.fn()
  const onReset = vi.fn()
  render(
    <ModelsFilter
      currentFilters={filters}
      onFilterChange={onFilterChange}
      onReset={onReset}
    />
  )
  return { onFilterChange, onReset }
}

async function openDialog() {
  await userEvent.click(screen.getByRole('button', { name: 'Filter' }))
}

function presetChip(id: string): HTMLElement {
  const chip = document.querySelector<HTMLElement>(`[data-preset="${id}"]`)
  if (!chip) throw new Error(`chip missing for preset: ${id}`)
  return chip
}

function timeInputs(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>('input[type="time"]')]
}

/** The filters the dialog handed back on its first edit. */
function firstChange(onFilterChange: ReturnType<typeof vi.fn>) {
  return onFilterChange.mock.calls[0][0] as DashboardFilters
}

describe('dashboard filter dialog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('offers every shared preset', async () => {
    renderDialog({ preset: '24h', time_granularity: 'hour' })
    await openDialog()

    for (const preset of TIME_WINDOW_PRESETS) {
      expect(presetChip(preset.id)).toBeVisible()
    }
  })

  it('applies a chosen preset without touching the granularity', async () => {
    const { onFilterChange } = renderDialog({
      preset: '24h',
      time_granularity: 'hour',
    })
    await openDialog()

    await userEvent.click(presetChip('7d'))

    const next = firstChange(onFilterChange)
    expect(next.preset).toBe('7d')
    expect(next.time_granularity).toBe('hour')
    // Bounds are dropped so the preset is resolved when the window is needed.
    expect(next.start_timestamp).toBeUndefined()
    expect(next.end_timestamp).toBeUndefined()
  })

  it('lights the chip of the applied preset and no other', async () => {
    renderDialog({ preset: 'last-week', time_granularity: 'day' })
    await openDialog()

    expect(presetChip('last-week')).toHaveAttribute('aria-pressed', 'true')
    expect(presetChip('24h')).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows the window a calendar preset resolves to right now', async () => {
    renderDialog({ preset: 'this-week', time_granularity: 'day' })
    await openDialog()

    const window = resolveTimeWindow('this-week', NOW)
    expect(screen.getAllByText(localDate(window.start))).toHaveLength(1)
    expect(screen.getAllByText(localDate(window.end))).toHaveLength(1)
  })

  it('turns the range into a custom one when a bound is edited', async () => {
    const { onFilterChange } = renderDialog({
      preset: 'yesterday',
      time_granularity: 'day',
    })
    await openDialog()
    const window = resolveTimeWindow('yesterday', NOW)

    fireEvent.change(timeInputs()[0], { target: { value: '08:15' } })

    const next = firstChange(onFilterChange)
    expect(next.preset).toBeUndefined()
    expect(next.end_timestamp).toBe(window.end)
    const start = new Date((next.start_timestamp ?? 0) * 1000)
    expect(start.getHours()).toBe(8)
    expect(start.getMinutes()).toBe(15)
  })

  it('has no apply button and resets through the parent', async () => {
    const { onFilterChange, onReset } = renderDialog({
      preset: '24h',
      time_granularity: 'hour',
    })
    await openDialog()

    expect(screen.queryByRole('button', { name: 'Apply Filters' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: 'Reset' }))

    expect(onReset).toHaveBeenCalledTimes(1)
    expect(onFilterChange).not.toHaveBeenCalled()
  })
})
