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
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import { getUserQuotaDates } from '@/features/dashboard/api'
import {
  buildQueryParams,
  calculateExtendedDashboardStats,
  type ExtendedDashboardStats,
} from '@/features/dashboard/lib'
import type {
  DashboardFilters,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { requireServerSuccess } from '@/lib/server-error-message'
import type { TimeWindow } from '@/lib/time-window'

import { useDashboardWindow } from './use-dashboard-window'

export interface UseDashboardDataResult {
  data: QuotaDataItem[]
  isLoading: boolean
  isFetching: boolean
  isError: boolean
  refetch: () => void
  window: TimeWindow
  stats: ExtendedDashboardStats
}

const EMPTY_DATA: QuotaDataItem[] = []

export function useDashboardData(
  filters?: DashboardFilters,
  isAdmin = false
): UseDashboardDataResult {
  const window = useDashboardWindow(filters)

  const queryParams = useMemo(
    () => buildQueryParams(window, filters),
    [window, filters]
  )

  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'quota-data', queryParams, isAdmin],
    queryFn: async () => {
      const response = await getUserQuotaDates(queryParams, isAdmin)
      return requireServerSuccess(response).data ?? EMPTY_DATA
    },
    staleTime: 60_000,
  })

  const rawData = data ?? EMPTY_DATA

  const stats = useMemo(
    () => calculateExtendedDashboardStats(rawData, window.start, window.end),
    [rawData, window.end, window.start]
  )

  return {
    data: rawData,
    isLoading,
    isFetching,
    isError,
    refetch: () => void refetch(),
    window,
    stats,
  }
}
