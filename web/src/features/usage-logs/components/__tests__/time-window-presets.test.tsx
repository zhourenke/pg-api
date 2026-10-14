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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  resolveTimeWindow,
  TIME_WINDOW_PRESETS,
  type TimeWindowId,
} from '@/lib/time-window'

import { CompactDateTimeRangePicker } from '../compact-date-time-range-picker'

/**
 * Midweek local midnight: every calendar preset covers a different range here,
 * so a chip and its window cannot be confused with a neighbour's, and the
 * assertions hold in any machine timezone.
 */
const NOW = new Date(2026, 7, 12)

function expectedRange(id: TimeWindowId): { start: Date; end: Date } {
  const window = resolveTimeWindow(id, NOW)
  return {
    start: new Date(window.start * 1000),
    end: new Date(window.end * 1000),
  }
}

async function openPicker() {
  // The trigger's accessible name is the current range, so it is not a stable
  // handle: with the popover open the matching chip carries the same name.
  // The trigger is the only popover trigger the picker renders.
  await userEvent.click(
    document.querySelectorAll<HTMLElement>('[aria-haspopup="dialog"]')[0]
  )
}

function presetChips(): HTMLElement[] {
  const group = screen.getByRole('group', { name: 'Time range' })
  return TIME_WINDOW_PRESETS.map((preset) => {
    const chip = group.querySelector<HTMLElement>(
      `[data-preset="${preset.id}"]`
    )
    if (!chip) throw new Error(`chip missing for preset: ${preset.id}`)
    return chip
  })
}

function chipOf(id: TimeWindowId): HTMLElement {
  const preset = TIME_WINDOW_PRESETS.find((item) => item.id === id)
  if (!preset) throw new Error(`unknown preset in fixture: ${id}`)
  const chip = screen
    .getByRole('group', { name: 'Time range' })
    .querySelector<HTMLElement>(`[data-preset="${preset.id}"]`)
  if (!chip) throw new Error(`chip missing for preset: ${id}`)
  return chip
}

describe('time window presets in the range picker', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('offers every preset instead of the five it replaced', async () => {
    render(<CompactDateTimeRangePicker onChange={vi.fn()} />)

    await openPicker()

    for (const chip of presetChips()) {
      expect(chip).toBeVisible()
    }
  })

  it.each(TIME_WINDOW_PRESETS.map((preset) => [preset.id] as const))(
    'converts the %s chip into its own window and reports the preset',
    async (id) => {
      const onChange = vi.fn()
      render(<CompactDateTimeRangePicker onChange={onChange} />)
      await openPicker()

      await userEvent.click(chipOf(id))

      const range = expectedRange(id)
      expect(onChange).toHaveBeenCalledWith({ ...range, preset: id })
    }
  )

  it('keeps the chip lit while the range still matches it', async () => {
    const range = expectedRange('last-week')
    render(
      <CompactDateTimeRangePicker
        start={range.start}
        end={range.end}
        preset='last-week'
        onChange={vi.fn()}
      />
    )

    // The trigger shows the preset name instead of the two timestamps, so it is
    // the second element carrying that name once the popover is open.
    await openPicker()

    expect(chipOf('last-week')).toHaveAttribute('aria-pressed', 'true')
  })

  it('leaves every chip unlit for a hand-picked range', async () => {
    render(
      <CompactDateTimeRangePicker
        start={new Date(2026, 7, 3, 9, 30)}
        end={new Date(2026, 7, 4, 11, 15)}
        onChange={vi.fn()}
      />
    )

    await openPicker()

    for (const chip of presetChips()) {
      expect(chip).toHaveAttribute('aria-pressed', 'false')
    }
  })

  it('keeps the timestamp label when no preset describes the range', () => {
    render(
      <CompactDateTimeRangePicker
        start={new Date(2026, 7, 3, 9, 30)}
        end={new Date(2026, 7, 4, 11, 15)}
        onChange={vi.fn()}
      />
    )

    expect(
      screen.getAllByText('2026-08-03 09:30 ~ 2026-08-04 11:15')[0]
    ).toBeVisible()
  })

  it('applies a hand-picked range without a preset after confirming', async () => {
    const onChange = vi.fn()
    render(
      <CompactDateTimeRangePicker
        start={new Date(2026, 7, 3, 9, 30)}
        end={new Date(2026, 7, 4, 11, 15)}
        onChange={onChange}
      />
    )
    await openPicker()

    await userEvent.click(
      screen.getByRole('button', { name: 'Custom Time Range' })
    )
    fireEvent.change(screen.getByLabelText('Start Time'), {
      target: { value: '2026-08-05T08:00' },
    })
    await userEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(onChange).toHaveBeenCalledWith({
      start: new Date('2026-08-05T08:00'),
      end: new Date(2026, 7, 4, 11, 15),
      preset: undefined,
    })
  })
})
