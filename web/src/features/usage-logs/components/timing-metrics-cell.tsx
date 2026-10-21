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
import { CircleAlert, Zap } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  dotColorMap,
  textColorMap,
  type StatusVariant,
} from '@/components/status-badge'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
  type ThroughputResult,
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
  const fullTitle = showFirstToken
    ? `${t('First token')}: ${firstTokenLabel} · ${t('Generate')}: ${outputLabel}`
    : `${t('Generate')}: ${outputLabel}`

  const labels = (
    <div
      className={cn(
        'flex min-h-8 max-w-full min-w-0 flex-col justify-center gap-0.5 text-xs leading-tight',
        props.compact &&
          'min-h-0 flex-row flex-wrap items-center gap-x-2.5 gap-y-1'
      )}
    >
      {showFirstToken && (
        <div className='flex max-w-full min-w-0 items-baseline gap-1.5'>
          {indicator === 'dot' && (
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                dotColorMap[firstTokenVariant]
              )}
            />
          )}
          <span className='text-muted-foreground min-w-0 shrink truncate'>
            {t('First token')}
          </span>
          <span
            className={cn(
              'min-w-0 shrink truncate tabular-nums',
              textColorMap[firstTokenVariant]
            )}
          >
            {firstTokenLabel}
          </span>
        </div>
      )}
      <div className='flex max-w-full min-w-0 items-baseline gap-1.5'>
        {indicator === 'dot' && (
          <span
            aria-hidden
            className={cn(
              'size-1.5 shrink-0 rounded-full',
              dotColorMap[outputVariant]
            )}
          />
        )}
        <span className='text-muted-foreground min-w-0 shrink truncate'>
          {t('Generate')}
        </span>
        <span
          className={cn(
            'min-w-0 shrink truncate tabular-nums',
            textColorMap[outputVariant]
          )}
        >
          {outputLabel}
        </span>
      </div>
    </div>
  )

  if (indicator === 'dot') {
    return (
      <div
        title={fullTitle}
        className={cn('flex max-w-full min-w-0 items-stretch', props.className)}
      >
        {labels}
      </div>
    )
  }

  return (
    <div
      title={fullTitle}
      className={cn(
        'flex max-w-full min-w-0 items-stretch gap-2',
        props.className
      )}
    >
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
  throughput?: ThroughputResult | null
  streamStatus?: LogOtherData['stream_status']
  className?: string
}

export function StreamTpsCell(props: StreamTpsCellProps) {
  const { t } = useTranslation()
  const [burstOpen, setBurstOpen] = useState(false)
  const isPointerRef = useRef(false)
  const showStreamError =
    props.isStream && props.streamStatus && props.streamStatus.status !== 'ok'

  const isBurst = props.throughput?.isBurst ?? false
  const outputMs = props.throughput?.outputMs
  const overallTps = props.throughput?.overallTokensPerSecond
  const effectiveTps = props.throughput
    ? props.throughput.tokensPerSecond
    : props.tokensPerSecond

  const tpsLabel =
    effectiveTps != null ? `${Math.round(effectiveTps)} t/s` : '—'
  const streamLabel = props.isStream ? t('Stream') : t('Non-stream')

  let secondLineContent: React.ReactNode = null
  if (isBurst) {
    secondLineContent = (
      <span className='inline-flex max-w-full min-w-0 items-center gap-0.5 truncate'>
        <Popover open={burstOpen} onOpenChange={setBurstOpen}>
          <PopoverTrigger
            openOnHover
            delay={200}
            render={
              <button
                type='button'
                aria-label={t('Burst Streaming')}
                onPointerDown={() => {
                  isPointerRef.current = true
                }}
                onMouseDown={() => {
                  isPointerRef.current = true
                }}
                onTouchStart={() => {
                  isPointerRef.current = true
                }}
                onKeyDown={() => {
                  isPointerRef.current = false
                }}
                onFocus={() => {
                  if (!isPointerRef.current) {
                    setBurstOpen(true)
                  }
                }}
                onBlur={() => {
                  isPointerRef.current = false
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  isPointerRef.current = false
                }}
                className='group/burst focus-visible:ring-ring inline-flex size-6 -my-1.5 -mx-1 cursor-help items-center justify-center rounded-xs text-amber-600/70 transition-colors hover:text-amber-600 active:text-amber-600 data-popup-open:text-amber-600 focus-visible:ring-1 focus-visible:outline-none touch-manipulation dark:text-amber-400/70 dark:hover:text-amber-300 dark:active:text-amber-300 dark:data-popup-open:text-amber-300'
              >
                <Zap className='size-3 shrink-0 transition-colors group-hover/burst:fill-amber-500/80 group-active/burst:fill-amber-500/80 group-data-popup-open/burst:fill-amber-500/80 group-focus-visible/burst:fill-amber-500/80 dark:group-hover/burst:fill-amber-400/80 dark:group-active/burst:fill-amber-400/80 dark:group-data-popup-open/burst:fill-amber-400/80 dark:group-focus-visible/burst:fill-amber-400/80' />
              </button>
            }
          />
          <PopoverContent
            side='top'
            sideOffset={6}
            showArrow
            className='border-border flex w-64 flex-col items-stretch gap-2 rounded-md border p-3 text-xs shadow-md ring-0'
          >
            <div className='text-foreground flex items-center gap-1.5 font-semibold'>
              <Zap className='size-3.5 shrink-0 fill-amber-500 text-amber-500 dark:fill-amber-400 dark:text-amber-400' />
              <span>{t('Burst Streaming')}</span>
            </div>
            <p className='text-muted-foreground text-xs leading-relaxed'>
              {t(
                'Upstream delivered tokens in an instant burst instead of a steady stream.'
              )}
            </p>
            {(outputMs != null || overallTps != null) && (
              <div className='border-border/60 text-muted-foreground flex flex-col gap-1.5 border-t pt-2 text-[11px]'>
                {outputMs != null && (
                  <div className='flex items-center justify-between gap-3'>
                    <span>{t('Generation duration')}</span>
                    <span className='text-foreground font-mono font-medium tabular-nums'>
                      {outputMs} ms
                    </span>
                  </div>
                )}
                {overallTps != null && (
                  <div className='flex items-center justify-between gap-3'>
                    <span>{t('Overall rate')}</span>
                    <span className='text-foreground font-mono font-medium tabular-nums'>
                      {Math.round(overallTps)} t/s
                    </span>
                  </div>
                )}
              </div>
            )}
          </PopoverContent>
        </Popover>
        <span className='shrink-0'>t/s</span>
      </span>
    )
  } else if (!props.compact || (props.isStream && effectiveTps != null)) {
    secondLineContent = tpsLabel
  }

  return (
    <div
      className={cn(
        'flex max-w-full min-w-0 shrink-0 flex-col items-start justify-center gap-0.5 text-xs leading-tight',
        !props.compact && 'min-h-8',
        props.compact && 'min-h-0 flex-row flex-wrap items-center gap-1.5',
        props.className
      )}
    >
      <span
        className={cn(
          'inline-flex max-w-full min-w-0 items-center gap-1 font-medium',
          props.isStream ? 'text-info' : 'text-muted-foreground'
        )}
      >
        <span className='max-w-full min-w-0 truncate'>{streamLabel}</span>
        {showStreamError && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger
                render={
                  <CircleAlert className='text-destructive size-3 shrink-0' />
                }
              />
              <TooltipContent
                side='top'
                className='flex w-56 flex-col gap-1.5 p-2.5 text-xs shadow-md'
              >
                <div className='text-destructive flex items-center gap-1.5 font-semibold'>
                  <CircleAlert className='size-3.5 shrink-0' />
                  <span>
                    {t('Stream Status')}: {t('Error')}
                  </span>
                </div>
                <div className='text-muted-foreground space-y-1'>
                  <p className='font-mono text-[11px] break-all'>
                    {props.streamStatus?.end_reason || 'unknown'}
                  </p>
                  {(props.streamStatus?.error_count ?? 0) > 0 && (
                    <p className='text-[11px]'>
                      <span>{t('Soft Errors')}:</span>{' '}
                      <span className='text-foreground font-mono font-medium'>
                        {props.streamStatus?.error_count}
                      </span>
                    </p>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>
      {secondLineContent && (
        <span className='text-muted-foreground/60 max-w-full min-w-0 truncate px-0.5 tabular-nums'>
          {secondLineContent}
        </span>
      )}
    </div>
  )
}
