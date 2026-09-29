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
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  formatThroughput,
} from '@/features/performance-metrics/lib/format'
import type { SuccessRatePoint } from '@/features/performance-metrics/types'
import { cn } from '@/lib/utils'

import { ModelPerfStatusStrip } from './model-perf-status-strip'

export type ModelPerfBadgeData = {
  window_start?: number
  window_end?: number
  /** Latency/speed cover the newest hours with traffic; status covers 24h. */
  recent_ttft_ms: number
  recent_tps: number
  recent_hours: number
  success_rate: number
  recent_success_series?: SuccessRatePoint[]
}

export interface ModelPerfBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  perf: ModelPerfBadgeData | undefined
}

export const ModelPerfBadge = memo(function ModelPerfBadge(
  props: ModelPerfBadgeProps
) {
  const { t } = useTranslation()
  const latencyText = formatLatency(props.perf?.recent_ttft_ms ?? 0)
  const speedText = formatThroughput(props.perf?.recent_tps ?? 0)
  const successRate = props.perf?.success_rate
  const hasSuccessRate =
    successRate != null &&
    Number.isFinite(successRate) &&
    successRate >= 0 &&
    successRate <= 100
  const recentHours = props.perf?.recent_hours ?? 0
  // One hour can be a handful of logs and a whole day hides the current state,
  // so the hover text names the window these two numbers actually cover.
  const recentWindow =
    recentHours > 0
      ? t('Last {{count}} hours with traffic', { count: recentHours })
      : null

  return (
    <div
      aria-label={t('Performance metrics for this model')}
      className={cn(
        'flex w-full min-w-0 items-center justify-between gap-3',
        props.className
      )}
    >
      <dl className='flex min-w-0 flex-wrap items-start gap-x-5 gap-y-2 text-xs tabular-nums'>
        <div className='w-24 shrink-0'>
          <dt
            title={t(
              'Success rate excludes business rejections and includes the current partial hour.'
            )}
            className='text-muted-foreground flex items-center justify-between gap-1 text-[11px] leading-4'
          >
            <span>{t('Status')}</span>
            <span className='font-mono'>
              {hasSuccessRate ? `${successRate.toFixed(2)}%` : '—'}
            </span>
          </dt>
          <dd className='mt-1'>
            <ModelPerfStatusStrip
              windowStart={props.perf?.window_start}
              series={props.perf?.recent_success_series}
            />
          </dd>
        </div>
        <div
          title={
            recentWindow
              ? `${t('First token latency')} · ${recentWindow}`
              : t('First token latency')
          }
          className='shrink-0'
        >
          <dt className='text-muted-foreground text-[11px] leading-4'>
            {t('Latency')}
          </dt>
          <dd className='mt-1 font-mono whitespace-nowrap'>
            {latencyText === '—' ? '— s' : latencyText}
          </dd>
        </div>
        <div
          title={
            recentWindow
              ? `${t('Model speed')} · ${recentWindow}`
              : t('Model speed')
          }
          className='shrink-0'
        >
          <dt className='text-muted-foreground text-[11px] leading-4'>
            {t('Speed')}
          </dt>
          <dd className='mt-1 font-mono whitespace-nowrap'>
            {speedText === '—' ? '— t/s' : speedText}
          </dd>
        </div>
      </dl>
      {props.children}
    </div>
  )
})
