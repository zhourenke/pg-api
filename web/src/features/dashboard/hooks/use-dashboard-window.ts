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

/**
 * The window a dashboard panel queries with, stable enough to sit in a query
 * key: it changes when the selected window changes and when the tab is brought
 * back to the foreground, never on every render.
 *
 * A preset is resolved here rather than read back from stored timestamps, which
 * is what keeps a calendar window ("today", "this week") correct without a
 * reload: a dashboard left open across local midnight picks up the new bounds
 * as soon as the user comes back to it.
 */
export function useDashboardWindow(filters?: DashboardFilters): TimeWindow {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', handleVisibilityChange)
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
