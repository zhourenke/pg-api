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
/**
 * The single definition of every selectable time window in the app.
 *
 * Two kinds of window exist and they must stay distinguishable:
 *
 * - `rolling`: `now - N hours` up to `now`. The same label always covers the
 *   same amount of elapsed time, no matter when it is read.
 * - `calendar`: local-time calendar boundaries (today, this week, ...). The
 *   bounds move at midnight, so a stored window must be resolved again rather
 *   than kept as a fixed pair of timestamps.
 *
 * A week starts on Monday, the convention the Chinese interface implies.
 *
 * Everything is expressed as second precision, matching the management APIs;
 * callers convert to whatever their own layer needs.
 */
import dayjs from '@/lib/dayjs'

/**
 * Every selectable window id, in the order a picker should offer them.
 *
 * This list exists so that the search schemas can validate a `preset` without
 * repeating the ids: adding a window means adding it here and describing it in
 * `TIME_WINDOW_PRESETS` (a test asserts the two stay in step), rather than
 * editing a zod enum in every route that reads one.
 */
export const TIME_WINDOW_IDS = [
  'today',
  'yesterday',
  '24h',
  'this-week',
  'last-week',
  '7d',
  'this-month',
  'last-month',
  '30d',
] as const satisfies readonly string[]

export type TimeWindowId = (typeof TIME_WINDOW_IDS)[number]

type TimeWindowKind = 'rolling' | 'calendar'

export interface TimeWindowPreset {
  id: TimeWindowId
  /** i18n key, resolved by the caller's `t()`. */
  labelKey: string
  /** `hours` is measured back from now; `days` marks a calendar day. */
  kind: TimeWindowKind
  /** Rolling windows only: elapsed hours counted back from the reference. */
  hours?: number
  /** Calendar windows only: which calendar unit the bounds follow. */
  unit?: 'day' | 'week' | 'month'
  /** Calendar windows only: how many units back, `0` meaning the current one. */
  offset?: number
}

export const TIME_WINDOW_PRESETS: readonly TimeWindowPreset[] = [
  {
    id: 'today',
    labelKey: 'Today',
    kind: 'calendar',
    unit: 'day',
    offset: 0,
  },
  {
    id: 'yesterday',
    labelKey: 'Yesterday',
    kind: 'calendar',
    unit: 'day',
    offset: 1,
  },
  { id: '24h', labelKey: '24 Hours', kind: 'rolling', hours: 24 },
  {
    id: 'this-week',
    labelKey: 'This week',
    kind: 'calendar',
    unit: 'week',
    offset: 0,
  },
  {
    id: 'last-week',
    labelKey: 'Last week',
    kind: 'calendar',
    unit: 'week',
    offset: 1,
  },
  { id: '7d', labelKey: '7 Days', kind: 'rolling', hours: 7 * 24 },
  {
    id: 'this-month',
    labelKey: 'This month',
    kind: 'calendar',
    unit: 'month',
    offset: 0,
  },
  {
    id: 'last-month',
    labelKey: 'Last month',
    kind: 'calendar',
    unit: 'month',
    offset: 1,
  },
  { id: '30d', labelKey: '30 Days', kind: 'rolling', hours: 30 * 24 },
]

/** The window a page starts on: today. */
export const DEFAULT_TIME_WINDOW_ID: TimeWindowId = 'today'

export interface TimeWindow {
  /** Inclusive first second of the window. */
  start: number
  /** Inclusive last second of the window. */
  end: number
}

export function resolveTimeWindow(
  id: TimeWindowId,
  now: Date = new Date()
): TimeWindow {
  const preset = TIME_WINDOW_PRESETS.find((item) => item.id === id)
  if (!preset) {
    throw new Error(`unknown time window preset: ${id}`)
  }
  if (preset.kind === 'rolling') {
    return rollingWindow(preset.hours ?? 0, now)
  }
  return calendarWindow(preset, now)
}

/**
 * The preset whose window currently equals the given one, or `null` for a
 * hand-picked range. Callers use it to keep the matching preset chip lit.
 */
export function matchTimeWindowPreset(
  window: TimeWindow,
  now: Date = new Date()
): TimeWindowId | null {
  const match = TIME_WINDOW_PRESETS.find((preset) => {
    const candidate = resolveTimeWindow(preset.id, now)
    return candidate.start === window.start && candidate.end === window.end
  })
  return match?.id ?? null
}

function rollingWindow(hours: number, now: Date): TimeWindow {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  return { start: nowSeconds - hours * 3600, end: nowSeconds }
}

function calendarWindow(preset: TimeWindowPreset, now: Date): TimeWindow {
  const offset = preset.offset ?? 0
  const reference = dayjs(now)

  if (preset.unit === 'day') {
    const day = reference.subtract(offset, 'day')
    return {
      start: day.startOf('day').unix(),
      end: day.endOf('day').unix(),
    }
  }

  if (preset.unit === 'week') {
    const week = reference.subtract(offset, 'week')
    return {
      start: week.startOf('week').unix(),
      end: week.endOf('week').unix(),
    }
  }

  const month = reference.subtract(offset, 'month')
  return {
    start: month.startOf('month').unix(),
    end: month.endOf('month').unix(),
  }
}

export function toTimeWindow(start: Date, end: Date): TimeWindow {
  return {
    start: Math.floor(start.getTime() / 1000),
    end: Math.floor(end.getTime() / 1000),
  }
}

/**
 * Whether a stored window still equals the preset that produced it. Calendar
 * windows move at local midnight, so a window read back from a URL, a store or
 * localStorage can be one day stale while the chosen preset stays correct.
 */
export function isTimeWindowStale(
  id: TimeWindowId,
  window: TimeWindow,
  now: Date = new Date()
): boolean {
  const fresh = resolveTimeWindow(id, now)
  return fresh.start !== window.start || fresh.end !== window.end
}
