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
import { beforeEach, describe, expect, test } from 'vitest'

import { setSiteDefaultTimeGranularity } from '@/lib/status-query'
import { resolveTimeWindow } from '@/lib/time-window'

import { DASHBOARD_CHART_PREFERENCES_STORAGE_KEY } from '../../constants'
import {
  buildDefaultDashboardFilters,
  getSavedChartPreferences,
  resolveDashboardWindow,
} from '../filters'

function storePreferences(value: Record<string, unknown>) {
  localStorage.setItem(
    DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
    JSON.stringify(value)
  )
}

beforeEach(() => {
  localStorage.clear()
  setSiteDefaultTimeGranularity(null)
})

describe('dashboard window resolution', () => {
  test('resolves a preset on demand rather than reusing stored bounds', () => {
    // Bounds a calendar preset produced yesterday: a dashboard that kept them
    // would keep asking for yesterday's window.
    expect(
      resolveDashboardWindow({
        preset: 'this-month',
        start_timestamp: 1,
        end_timestamp: 2,
      })
    ).toEqual(resolveTimeWindow('this-month'))
  })

  test('uses the stored bounds of a hand-picked range', () => {
    expect(
      resolveDashboardWindow({ start_timestamp: 1000, end_timestamp: 2000 })
    ).toEqual({ start: 1000, end: 2000 })
  })

  test('falls back to the default window when nothing is chosen', () => {
    expect(resolveDashboardWindow()).toEqual(resolveTimeWindow('24h'))
    expect(resolveDashboardWindow({})).toEqual(resolveTimeWindow('24h'))
  })
})

describe('dashboard chart preferences', () => {
  test('reads the window back as a preset id', () => {
    storePreferences({ defaultTimeWindowId: 'last-week' })

    expect(getSavedChartPreferences().defaultTimeWindowId).toBe('last-week')
  })

  test('maps the day counts the old preference stored onto the nearest preset', () => {
    const cases: [number, string][] = [
      [1, '24h'],
      [7, '7d'],
      [14, '7d'],
      [29, '30d'],
    ]

    for (const [days, expected] of cases) {
      storePreferences({ defaultTimeRangeDays: days })
      expect(getSavedChartPreferences().defaultTimeWindowId).toBe(expected)
    }
  })

  test('ignores a window id that is not one of the presets', () => {
    storePreferences({ defaultTimeWindowId: 'last-century' })

    expect(getSavedChartPreferences().defaultTimeWindowId).toBe('24h')
  })

  test('builds the default filters as a preset without stored bounds', () => {
    storePreferences({
      defaultTimeWindowId: 'last-week',
      defaultTimeGranularity: 'day',
    })

    expect(buildDefaultDashboardFilters()).toEqual({
      preset: 'last-week',
      time_granularity: 'day',
      username: '',
    })
  })
})
