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
import { useEffect, useMemo, useState } from 'react'

import type { TimeWindow } from '@/lib/time-window'

import { resolveDashboardWindow } from '../lib'
import type { DashboardFilters } from '../types'

const DASHBOARD_WINDOW_REFRESH_EVENT = 'dashboard:window-refresh'

/**
 * Re-resolve every mounted dashboard window against the current clock. The
 * dashboard's Refresh button calls this so a manual refresh advances rolling
 * windows ("last 24h", "7d"); merely bringing the tab back to the foreground
 * must not, otherwise the page would refetch every time the user returns to it.
 */
export function refreshDashboardWindow(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new Event(DASHBOARD_WINDOW_REFRESH_EVENT))
}

/**
 * The window a dashboard panel queries with, stable enough to sit in a query
 * key: it changes when the selected window changes and when a manual refresh
 * asks for a fresh "now", never on every render or on tab focus.
 *
 * A preset is resolved here rather than read back from stored timestamps, which
 * is what keeps a calendar window ("today", "this week") correct without a
 * reload: a manual refresh after local midnight picks up the new bounds.
 */
export function useDashboardWindow(filters?: DashboardFilters): TimeWindow {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const handleRefresh = () => setNow(new Date())
    window.addEventListener(DASHBOARD_WINDOW_REFRESH_EVENT, handleRefresh)
    return () =>
      window.removeEventListener(DASHBOARD_WINDOW_REFRESH_EVENT, handleRefresh)
  }, [])

  // The three fields are read out individually so that a caller passing a fresh
  // object literal still gets a memo that holds between renders.
  const { preset, start_timestamp: start, end_timestamp: end } = filters ?? {}

  return useMemo(
    () =>
      resolveDashboardWindow(
        { preset, start_timestamp: start, end_timestamp: end },
        now
      ),
    [preset, start, end, now]
  )
}
