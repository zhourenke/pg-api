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
import { useTranslation } from 'react-i18next'

import { EmptyState } from '@/components/empty-state'
import { GroupBadge } from '@/components/group-badge'
import { LoadingState } from '@/components/loading-state'
import { getPerfMetrics } from '@/features/performance-metrics/api'
import type {
  PerformanceGroup,
  PerformanceSeriesPoint,
} from '@/features/performance-metrics/types'
import { requireServerSuccess } from '@/lib/server-error-message'

import type { PricingModel } from '../types'
import {
  ModelOverviewTrendChart,
  type TrendSlot,
} from './model-overview-trend-chart'

const WINDOW_HOURS = 24
const SECONDS_PER_HOUR = 3600

function formatFullTime(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:00`
}

/**
 * Expands a group's sparse hourly series into the fixed 24-hour window so
 * idle hours stay on the axis instead of being skipped.
 */
function buildTrendSlots(
  group: PerformanceGroup,
  windowStart: number | undefined
): TrendSlot[] {
  const byHour = new Map<number, PerformanceSeriesPoint>()
  for (const point of group.series ?? []) byHour.set(point.ts, point)
  const start = windowStart ?? group.series?.[0]?.ts ?? 0

  return Array.from({ length: WINDOW_HOURS }, (_, index) => {
    const ts = start + index * SECONDS_PER_HOUR
    const point = byHour.get(ts)
    const date = new Date(ts * 1000)
    return {
      hour: `${String(date.getHours()).padStart(2, '0')}:00`,
      fullTime: formatFullTime(date),
      latency:
        point != null && point.avg_ttft_ms > 0 ? point.avg_ttft_ms : null,
      speed: point != null && point.avg_tps > 0 ? point.avg_tps : null,
      success:
        point == null || !Number.isFinite(point.success_rate)
          ? null
          : point.success_rate,
    }
  })
}

function hasTraffic(slots: TrendSlot[]): boolean {
  return slots.some(
    (slot) => slot.latency != null || slot.speed != null || slot.success != null
  )
}

export function ModelOverviewTrend(props: { model: PricingModel }) {
  const { t } = useTranslation()
  const metricsQuery = useQuery({
    queryKey: ['perf-metrics', props.model.model_name],
    queryFn: async () =>
      requireServerSuccess(await getPerfMetrics(props.model.model_name, 24)),
    staleTime: 60 * 1000,
  })

  const windowStart = metricsQuery.data?.data.window_start
  const groups = metricsQuery.data?.data.groups
  const trendGroups = useMemo(
    () =>
      (groups ?? []).map((group) => ({
        name: group.group,
        slots: buildTrendSlots(group, windowStart),
      })),
    [groups, windowStart]
  )

  if (metricsQuery.isPending) {
    return <LoadingState />
  }

  if (trendGroups.length === 0) {
    return (
      <EmptyState
        bordered
        title={t('No data available')}
        description={t('Performance data is not yet available for this model.')}
      />
    )
  }

  return (
    <div className='space-y-4'>
      {trendGroups.map((trend) => (
        <section
          key={trend.name}
          className='bg-card/60 space-y-3 rounded-xl border p-4 shadow-sm'
        >
          <div className='flex flex-wrap items-center justify-between gap-2'>
            <h3 className='flex items-center gap-2 text-sm font-semibold'>
              <GroupBadge group={trend.name} size='sm' />
            </h3>
            <span className='text-muted-foreground text-[11px]'>
              {t('Last 24 hours')}
            </span>
          </div>
          {hasTraffic(trend.slots) ? (
            <ModelOverviewTrendChart slots={trend.slots} />
          ) : (
            <div className='text-muted-foreground flex h-52 items-center justify-center rounded-lg border text-xs sm:h-64'>
              {t('No data available')}
            </div>
          )}
        </section>
      ))}
    </div>
  )
}
