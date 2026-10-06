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
import { CircleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  dotColorMap,
  textColorMap,
  type StatusVariant,
} from '@/components/status-badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { formatUseTime } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  getFirstResponseTimeColor,
  getOutputDurationMs,
  getResponseTimeColor,
} from '../lib/format'
import type { LogOtherData } from '../types'

/**
 * Softened fills for the full-height timing bar. The bar sits directly beside
 * dense numeric text, so the saturated `dotColorMap` tones (tuned for small
 * dots and badges) read as too high-contrast at that size; a translucent fill
 * keeps the status legible while matching the page's muted palette.
 */
const barColorMap: Record<StatusVariant, string> = {
  ...dotColorMap,
  success: 'bg-success/90',
  warning: 'bg-warning/80',
  danger: 'bg-destructive/80',
  neutral: 'bg-neutral/80',
}

interface TimingMetricsCellProps {
  /**
   * Total request duration in milliseconds. The caller resolves it from the
   * log's exact `use_time_ms` when present, so the label keeps millisecond
   * resolution instead of rounding to whole seconds.
   */
  durationMs: number
  completionTokens: number
  /**
   * First-token latency in milliseconds. For a streamed reply it is subtracted
   * from the total duration, because the cell labels the remainder as the
   * output duration rather than as the whole request.
   */
  frtMs?: number
  isStream: boolean
  className?: string
  /**
   * `bar` (default) draws a full-height color segment beside the labels,
   * matching the dense desktop table. `dot` swaps that segment for small
   * status dots inline with each label, matching the lighter-weight status
   * indicator used elsewhere on the mobile card.
   */
  indicator?: 'bar' | 'dot'
  compact?: boolean
}

export function TimingMetricsCell(props: TimingMetricsCellProps) {
  const { t } = useTranslation()
  const indicator = props.indicator ?? 'bar'
  const showFirstToken = props.isStream
  const firstTokenSeconds =
    props.frtMs != null && props.frtMs > 0 ? props.frtMs / 1000 : null
  const firstTokenVariant: StatusVariant =
    firstTokenSeconds == null
      ? 'neutral'
      : getFirstResponseTimeColor(firstTokenSeconds)
  const outputSeconds =
    getOutputDurationMs(props.durationMs, props.frtMs, props.isStream) / 1000
  const outputVariant = getResponseTimeColor(
    outputSeconds,
    props.completionTokens
  )
  const firstTokenLabel =
    firstTokenSeconds == null ? t('N/A') : formatUseTime(firstTokenSeconds)
  const outputLabel = formatUseTime(outputSeconds)

  const labels = (
    <div
      className={cn(
        'flex min-h-8 min-w-0 flex-col justify-center gap-0.5 text-xs leading-tight',
        props.compact &&
          'min-h-0 flex-row flex-wrap items-center gap-x-2.5 gap-y-1'
      )}
    >
      {showFirstToken && (
        <div className='flex min-w-0 items-baseline gap-1.5'>
          {indicator === 'dot' && (
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                dotColorMap[firstTokenVariant]
              )}
            />
          )}
          <span className='text-muted-foreground min-w-0 truncate'>
            {t('First token')}
          </span>
          <span
            className={cn(
              'shrink-0 tabular-nums',
              textColorMap[firstTokenVariant]
            )}
          >
            {firstTokenLabel}
          </span>
        </div>
      )}
      <div className='flex min-w-0 items-baseline gap-1.5'>
        {indicator === 'dot' && (
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              dotColorMap[outputVariant]
            )}
          />
        )}
        <span className='text-muted-foreground min-w-0 truncate'>
          {t('Output')}
        </span>
        <span
          className={cn('shrink-0 tabular-nums', textColorMap[outputVariant])}
        >
          {outputLabel}
        </span>
      </div>
    </div>
  )

  if (indicator === 'dot') {
    return (
      <div className={cn('flex items-stretch', props.className)}>{labels}</div>
    )
  }

  return (
    <div className={cn('flex items-stretch gap-2', props.className)}>
      <span
        aria-hidden
        className={cn(
          'flex w-1 shrink-0 flex-col overflow-hidden rounded-full',
          !showFirstToken && barColorMap[outputVariant]
        )}
      >
        {showFirstToken && (
          <>
            <span className={cn('flex-1', barColorMap[firstTokenVariant])} />
            <span className={cn('flex-1', barColorMap[outputVariant])} />
          </>
        )}
      </span>
      {labels}
    </div>
  )
}

interface StreamTpsCellProps {
  isStream: boolean
  compact?: boolean
  tokensPerSecond?: number | null
  streamStatus?: LogOtherData['stream_status']
  className?: string
}

export function StreamTpsCell(props: StreamTpsCellProps) {
  const { t } = useTranslation()
  const showStreamError =
    props.isStream && props.streamStatus && props.streamStatus.status !== 'ok'
  const tpsLabel =
    props.tokensPerSecond != null
      ? `${Math.round(props.tokensPerSecond)} t/s`
      : '—'
  const streamLabel = props.isStream ? t('Stream') : t('Non-stream')

  return (
    <div
      className={cn(
        'flex max-w-full min-w-0 shrink-0 flex-col items-start justify-center gap-0.5 text-xs leading-tight',
        props.compact && 'flex-row flex-wrap items-center gap-1.5',
        props.className
      )}
    >
      <span
        className={cn(
          'inline-flex max-w-full min-w-0 items-center gap-1 font-medium',
          props.isStream ? 'text-info' : 'text-muted-foreground'
        )}
      >
        <span className='min-w-0 truncate'>{streamLabel}</span>
        {showStreamError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <CircleAlert className='text-destructive size-3 shrink-0' />
                }
              />
              <TooltipContent>
                <div className='space-y-0.5 text-xs'>
                  <p>
                    {t('Stream Status')}: {t('Error')}
                  </p>
                  <p>{props.streamStatus?.end_reason || 'unknown'}</p>
                  {(props.streamStatus?.error_count ?? 0) > 0 && (
                    <p>
                      {t('Soft Errors')}: {props.streamStatus?.error_count}
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
      {(!props.compact ||
        (props.isStream && props.tokensPerSecond != null)) && (
        <span className='text-muted-foreground/60 min-w-0 truncate px-0.5 tabular-nums'>
          {tpsLabel}
        </span>
      )}
    </div>
  )
}
