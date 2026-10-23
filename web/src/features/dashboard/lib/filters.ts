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
import {
  DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
  DEFAULT_DASHBOARD_CHART_PREFERENCES,
  DEFAULT_TIME_GRANULARITY,
  EMPTY_DASHBOARD_FILTERS,
  TIME_GRANULARITY_STORAGE_KEY,
} from '@/features/dashboard/constants'
import type {
  DashboardChartPreferences,
  DashboardFilters,
} from '@/features/dashboard/types'
import { getSiteDefaultTimeGranularity } from '@/lib/status-query'
import type { TimeGranularity } from '@/lib/time'
import {
  DEFAULT_TIME_WINDOW_ID,
  resolveTimeWindow,
  TIME_WINDOW_PRESETS,
  type TimeWindow,
  type TimeWindowId,
} from '@/lib/time-window'

/**
 * Day counts the chart preferences used to store, mapped onto the nearest of
 * the shared presets. `14` has no equivalent of its own because every picker in
 * the app now offers the same nine windows.
 */
const LEGACY_TIME_WINDOW_BY_DAYS: Record<number, TimeWindowId> = {
  1: '24h',
  7: '7d',
  14: '7d',
  29: '30d',
}

function isTimeGranularity(value: unknown): value is TimeGranularity {
  return value === 'hour' || value === 'day' || value === 'week'
}

function isTimeWindowId(value: unknown): value is TimeWindowId {
  return (
    typeof value === 'string' &&
    TIME_WINDOW_PRESETS.some((preset) => preset.id === value)
  )
}

function readTimeWindowId(value: unknown, legacyDays: unknown): TimeWindowId {
  if (isTimeWindowId(value)) return value
  if (
    typeof legacyDays === 'number' &&
    LEGACY_TIME_WINDOW_BY_DAYS[legacyDays] !== undefined
  ) {
    return LEGACY_TIME_WINDOW_BY_DAYS[legacyDays]
  }
  return DEFAULT_TIME_WINDOW_ID
}

function getLegacySavedGranularity(): TimeGranularity {
  const siteDefault =
    getSiteDefaultTimeGranularity() ?? DEFAULT_TIME_GRANULARITY
  if (typeof window === 'undefined') return siteDefault
  const saved = localStorage.getItem(TIME_GRANULARITY_STORAGE_KEY)
  return isTimeGranularity(saved) ? saved : siteDefault
}

/**
 * True when this browser stores its own granularity, which keeps it from
 * following the site default set in Ops > Log maintenance.
 */
export function hasLocalGranularityChoice(): boolean {
  if (typeof window === 'undefined') return false
  if (isTimeGranularity(localStorage.getItem(TIME_GRANULARITY_STORAGE_KEY))) {
    return true
  }
  const raw = localStorage.getItem(DASHBOARD_CHART_PREFERENCES_STORAGE_KEY)
  if (!raw) return false
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardChartPreferences>
    return isTimeGranularity(parsed.defaultTimeGranularity)
  } catch {
    return false
  }
}

export function cleanFilters<T extends object>(filters: T): Partial<T> {
  const cleaned: Partial<T> = {}
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue
    if (typeof value === 'string') {
      const trimmed = value.trim()
      if (trimmed) cleaned[key as keyof T] = trimmed as T[keyof T]
      continue
    }
    cleaned[key as keyof T] = value as T[keyof T]
  }
  return cleaned
}

export function getSavedGranularity(
  override?: TimeGranularity
): TimeGranularity {
  if (override) return override
  return getSavedChartPreferences().defaultTimeGranularity
}

export function saveGranularity(granularity: TimeGranularity): void {
  if (typeof window === 'undefined') return
  saveChartPreferences({
    ...getSavedChartPreferences(),
    defaultTimeGranularity: granularity,
  })
  localStorage.setItem(TIME_GRANULARITY_STORAGE_KEY, granularity)
}

export function getSavedChartPreferences(): DashboardChartPreferences {
  if (typeof window === 'undefined') return DEFAULT_DASHBOARD_CHART_PREFERENCES

  const fallbackPreferences = {
    ...DEFAULT_DASHBOARD_CHART_PREFERENCES,
    defaultTimeGranularity: getLegacySavedGranularity(),
  }

  try {
    const raw = localStorage.getItem(DASHBOARD_CHART_PREFERENCES_STORAGE_KEY)
    if (!raw) return fallbackPreferences

    const parsed = JSON.parse(raw) as Partial<DashboardChartPreferences> & {
      defaultTimeRangeDays?: unknown
    }
    return {
      defaultTimeWindowId: readTimeWindowId(
        parsed.defaultTimeWindowId,
        parsed.defaultTimeRangeDays
      ),
      defaultTimeGranularity: isTimeGranularity(parsed.defaultTimeGranularity)
        ? parsed.defaultTimeGranularity
        : fallbackPreferences.defaultTimeGranularity,
    }
  } catch {
    return fallbackPreferences
  }
}

export function saveChartPreferences(
  preferences: DashboardChartPreferences
): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(
    DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
    JSON.stringify(preferences)
  )
}

export function buildDefaultDashboardFilters(
  preferences: DashboardChartPreferences = getSavedChartPreferences()
): DashboardFilters {
  return {
    ...EMPTY_DASHBOARD_FILTERS,
    preset: preferences.defaultTimeWindowId,
    time_granularity: preferences.defaultTimeGranularity,
  }
}

/**
 * The window the dashboard queries with. A preset is resolved on demand, so a
 * calendar window ("today", "this month") is never served from a stale pair of
 * stored timestamps; a hand-picked range carries no preset and is used as
 * stored.
 */
export function resolveDashboardWindow(
  filters?: DashboardFilters,
  now: Date = new Date()
): TimeWindow {
  if (filters?.preset && isTimeWindowId(filters.preset)) {
    return resolveTimeWindow(filters.preset, now)
  }
  if (filters?.start_timestamp && filters?.end_timestamp) {
    return { start: filters.start_timestamp, end: filters.end_timestamp }
  }
  return resolveTimeWindow(DEFAULT_TIME_WINDOW_ID, now)
}

export function buildQueryParams(
  window: TimeWindow,
  filters?: { time_granularity?: TimeGranularity; username?: string }
): {
  start_timestamp: number
  end_timestamp: number
  default_time: string
  username?: string
} {
  return {
    start_timestamp: window.start,
    end_timestamp: window.end,
    default_time: getSavedGranularity(filters?.time_granularity),
    ...(filters?.username && { username: filters.username }),
  }
}
