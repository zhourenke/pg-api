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

import {
  DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
  TIME_GRANULARITY_STORAGE_KEY,
} from '../../constants'
import {
  buildDefaultDashboardFilters,
  getSavedGranularity,
  hasLocalGranularityChoice,
} from '../filters'

beforeEach(() => {
  localStorage.clear()
  setSiteDefaultTimeGranularity(null)
})

describe('dashboard granularity default', () => {
  test('follows the site default when the browser never chose one', () => {
    setSiteDefaultTimeGranularity('day')

    expect(hasLocalGranularityChoice()).toBe(false)
    expect(getSavedGranularity()).toBe('day')
    expect(buildDefaultDashboardFilters().time_granularity).toBe('day')
  })

  test('keeps the browser choice over the site default', () => {
    setSiteDefaultTimeGranularity('day')
    localStorage.setItem(TIME_GRANULARITY_STORAGE_KEY, 'week')

    expect(hasLocalGranularityChoice()).toBe(true)
    expect(getSavedGranularity()).toBe('week')
  })

  test('reads a stored chart preference as a browser choice', () => {
    setSiteDefaultTimeGranularity('day')
    localStorage.setItem(
      DASHBOARD_CHART_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        defaultTimeGranularity: 'hour',
        defaultTimeWindowId: '7d',
      })
    )

    expect(hasLocalGranularityChoice()).toBe(true)
    expect(getSavedGranularity()).toBe('hour')
  })

  test('falls back to hourly when neither a site default nor a choice exists', () => {
    expect(getSavedGranularity()).toBe('hour')
  })
})
