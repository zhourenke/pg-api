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
import { describe, expect, it } from 'vitest'

import dayjs from '@/lib/dayjs'
import {
  DEFAULT_TIME_WINDOW_ID,
  matchTimeWindowPreset,
  resolveTimeWindow,
  TIME_WINDOW_IDS,
  TIME_WINDOW_PRESETS,
  type TimeWindowId,
} from '@/lib/time-window'

/**
 * A fixed reference instant. Timestamps are compared as seconds rather than as
 * local clock text, and the calendar expectations below are built by moving the
 * same instant, so the whole file holds in any machine timezone.
 */
const NOW = new Date('2026-08-13T14:31:07+08:00')
const NOW_SECONDS = Math.floor(NOW.getTime() / 1000)

function secondsOf(moment: dayjs.Dayjs): number {
  return moment.unix()
}

describe('time window presets', () => {
  it('exposes the nine windows with unique ids and label keys', () => {
    const ids = TIME_WINDOW_PRESETS.map((preset) => preset.id)
    const labelKeys = TIME_WINDOW_PRESETS.map((preset) => preset.labelKey)

    expect(ids).toEqual([
      'today',
      'yesterday',
      '24h',
      'this-week',
      'last-week',
      '7d',
      'this-month',
      'last-month',
      '30d',
    ])
    expect(DEFAULT_TIME_WINDOW_ID).toBe('today')
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labelKeys).size).toBe(labelKeys.length)
  })

  it('keeps the id list the URL schemas validate against in the same order', () => {
    // The search schemas build a zod enum from TIME_WINDOW_IDS, so a window
    // added to one list and not the other must fail here rather than silently
    // dropping out of a URL.
    expect([...TIME_WINDOW_IDS]).toEqual(
      TIME_WINDOW_PRESETS.map((preset) => preset.id)
    )
  })
})

describe('rolling windows end at the reference instant', () => {
  it.each([
    ['24h', 24],
    ['7d', 7 * 24],
    ['30d', 30 * 24],
  ] as const)('%s spans exactly %i hours back from now', (id, hours) => {
    const window = resolveTimeWindow(id, NOW)

    expect(window.end).toBe(NOW_SECONDS)
    expect(window.end - window.start).toBe(hours * 3600)
  })
})

describe('calendar windows follow local boundaries', () => {
  it('covers the whole day for today', () => {
    const window = resolveTimeWindow('today', NOW)

    expect(window.start).toBe(secondsOf(dayjs(NOW).startOf('day')))
    expect(window.end).toBe(secondsOf(dayjs(NOW).endOf('day')))
  })

  it('moves one whole day back for yesterday', () => {
    const yesterday = dayjs(NOW).subtract(1, 'day')
    const window = resolveTimeWindow('yesterday', NOW)

    expect(window.start).toBe(secondsOf(yesterday.startOf('day')))
    expect(window.end).toBe(secondsOf(yesterday.endOf('day')))
  })

  it('starts this week on Monday and ends on Sunday', () => {
    const window = resolveTimeWindow('this-week', NOW)

    expect(dayjs.unix(window.start).day()).toBe(1)
    expect(dayjs.unix(window.start).format('YYYY-MM-DD')).toBe('2026-08-10')
    expect(dayjs.unix(window.end).day()).toBe(0)
    expect(dayjs.unix(window.end).format('YYYY-MM-DD')).toBe('2026-08-16')
  })

  it('puts last week immediately before this week', () => {
    const thisWeek = resolveTimeWindow('this-week', NOW)
    const lastWeek = resolveTimeWindow('last-week', NOW)

    expect(dayjs.unix(lastWeek.start).format('YYYY-MM-DD')).toBe('2026-08-03')
    expect(dayjs.unix(lastWeek.end).format('YYYY-MM-DD')).toBe('2026-08-09')
    expect(lastWeek.end).toBe(thisWeek.start - 1)
    expect(thisWeek.start - lastWeek.start).toBe(7 * 24 * 3600)
  })

  it('covers the full calendar month for this month and last month', () => {
    const thisMonth = resolveTimeWindow('this-month', NOW)
    const lastMonth = resolveTimeWindow('last-month', NOW)

    expect(dayjs.unix(thisMonth.start).format('YYYY-MM-DD')).toBe('2026-08-01')
    expect(dayjs.unix(thisMonth.end).format('YYYY-MM-DD')).toBe('2026-08-31')
    expect(dayjs.unix(lastMonth.start).format('YYYY-MM-DD')).toBe('2026-07-01')
    expect(dayjs.unix(lastMonth.end).format('YYYY-MM-DD')).toBe('2026-07-31')
  })

  it('resolves last month on the 31st of a longer month to the whole short month', () => {
    const reference = new Date('2026-05-31T09:00:00+08:00')
    const window = resolveTimeWindow('last-month', reference)

    expect(dayjs.unix(window.start).format('YYYY-MM-DD')).toBe('2026-04-01')
    expect(dayjs.unix(window.end).format('YYYY-MM-DD')).toBe('2026-04-30')
  })
})

describe('calendar windows keep clean day boundaries', () => {
  // A local calendar day must start at local midnight and end at the last
  // second of the same local day, whatever the machine timezone or whether a
  // daylight saving change falls inside it. Asserting the boundaries rather
  // than a duration keeps this true in any TZ the suite runs under.
  const springForward = new Date('2026-03-08T12:00:00Z')

  it.each([0, 1, 2, 3, 4, 5, 6])(
    'starts the day %i days around the transition at local midnight',
    (offset) => {
      const reference = new Date(springForward.getTime() + offset * 86400_000)
      const window = resolveTimeWindow('today', reference)
      const start = dayjs.unix(window.start)
      const end = dayjs.unix(window.end)

      expect(start.format('HH:mm:ss')).toBe('00:00:00')
      expect(end.format('HH:mm:ss')).toBe('23:59:59')
      expect(start.format('YYYY-MM-DD')).toBe(end.format('YYYY-MM-DD'))
    }
  )

  it('keeps yesterday adjacent to today at every offset around the transition', () => {
    for (const offset of [0, 1, 2, 3]) {
      const reference = new Date(springForward.getTime() + offset * 86400_000)
      const today = resolveTimeWindow('today', reference)
      const yesterday = resolveTimeWindow('yesterday', reference)

      expect(yesterday.end).toBe(today.start - 1)
    }
  })

  it('keeps a rolling window at a fixed elapsed length', () => {
    for (const offset of [0, 1, 2, 3]) {
      const reference = new Date(springForward.getTime() + offset * 86400_000)
      const window = resolveTimeWindow('24h', reference)

      expect(window.end - window.start).toBe(24 * 3600)
    }
  })
})

describe('matching a window back to a preset', () => {
  it.each([
    '24h',
    '7d',
    '30d',
    'today',
    'yesterday',
    'this-week',
    'last-week',
    'this-month',
    'last-month',
  ] as const)('recognises the %s window', (id: TimeWindowId) => {
    expect(matchTimeWindowPreset(resolveTimeWindow(id, NOW), NOW)).toBe(id)
  })

  it('returns null for a hand-picked range', () => {
    const window = { start: NOW_SECONDS - 1234, end: NOW_SECONDS }

    expect(matchTimeWindowPreset(window, NOW)).toBeNull()
  })

  it('does not mistake the trailing 24 hours for a calendar day', () => {
    const rolling = resolveTimeWindow('24h', NOW)

    expect(matchTimeWindowPreset(rolling, NOW)).toBe('24h')
    expect(resolveTimeWindow('today', NOW).start).not.toBe(rolling.start)
  })
})
