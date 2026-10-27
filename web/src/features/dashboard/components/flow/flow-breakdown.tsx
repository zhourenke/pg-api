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
import { X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import {
  buildFlowBreakdown,
  toggleFlowBreakdownFilter,
  type FlowBreakdown,
  type FlowBreakdownSegment,
} from '@/features/dashboard/lib/flow-breakdown'
import type {
  FlowMetric,
  FlowNodeFilter,
  FlowNodeKind,
  FlowQuotaDataItem,
  FlowRole,
} from '@/features/dashboard/types'
import { useMediaQuery } from '@/hooks'
import { cn } from '@/lib/utils'

interface FlowBreakdownProps {
  rows: FlowQuotaDataItem[]
  metric: FlowMetric
  role: FlowRole
  stages: FlowNodeKind[]
  topLimit: number
  loading?: boolean
  errorMessage?: string | null
  maskSensitive?: boolean
  stageLabels: Record<FlowNodeKind, string>
  metricLabel: string
  formatMetricValue: (value: number) => string
}

function filterLabel(breakdown: FlowBreakdown, filter: FlowNodeFilter): string {
  for (const stage of breakdown.stages) {
    if (stage.kind !== filter.kind) continue
    const segment = stage.segments.find((item) => item.id === filter.id)
    if (segment) return segment.label
  }
  return filter.id
}

function segmentPercent(segment: FlowBreakdownSegment): number {
  return Math.round(segment.share * 100)
}

export function FlowBreakdown(props: FlowBreakdownProps) {
  const { t } = useTranslation()
  const isNarrow = useMediaQuery('(max-width: 640px)')
  const [activeFilters, setActiveFilters] = useState<FlowNodeFilter[]>([])

  const breakdown = useMemo(
    () =>
      buildFlowBreakdown(
        props.rows,
        props.metric,
        props.role,
        props.stages,
        activeFilters,
        {
          topLimit: props.topLimit,
          maskSensitive: props.maskSensitive,
          otherLabel: (kind) =>
            t('Other {{stage}}', { stage: t(props.stageLabels[kind]) }),
        }
      ),
    [
      props.rows,
      props.metric,
      props.role,
      props.stages,
      props.topLimit,
      props.maskSensitive,
      props.stageLabels,
      activeFilters,
      t,
    ]
  )

  const toggleSegment = (segment: FlowBreakdownSegment) => {
    setActiveFilters((prev) =>
      toggleFlowBreakdownFilter(prev, { kind: segment.kind, id: segment.id })
    )
  }

  const deepestActive = props.stages.reduce((deepest, kind, index) => {
    return activeFilters.some((filter) => filter.kind === kind)
      ? Math.max(deepest, index)
      : deepest
  }, -1)
  const shownStages = isNarrow
    ? props.stages.slice(0, Math.min(props.stages.length, deepestActive + 2))
    : props.stages
  const visibleStageSet = new Set(shownStages)

  let body = null
  if (props.loading) {
    body = (
      <div className='flex flex-col gap-4'>
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className='h-14 w-full' />
        ))}
      </div>
    )
  } else if (props.errorMessage) {
    body = (
      <Alert variant='destructive' className='max-w-md'>
        <AlertTitle>{t('Failed to load')}</AlertTitle>
        <AlertDescription>{props.errorMessage}</AlertDescription>
      </Alert>
    )
  } else if (breakdown.total <= 0) {
    body = (
      <Empty className='border-0 py-12'>
        <EmptyHeader>
          <EmptyMedia variant='icon'>
            <svg
              viewBox='0 0 24 24'
              fill='none'
              stroke='currentColor'
              strokeWidth='1.5'
              aria-hidden='true'
            >
              <path d='M4 6h16M4 12h10M4 18h6' strokeLinecap='round' />
            </svg>
          </EmptyMedia>
          <EmptyTitle>{t('No flow data available')}</EmptyTitle>
          <EmptyDescription>{t('No data available')}</EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  } else {
    body = (
      <div className='flex flex-col gap-5'>
        {breakdown.stages
          .filter((stage) => visibleStageSet.has(stage.kind))
          .map((stage) => {
            const stageFilter = activeFilters.find(
              (filter) => filter.kind === stage.kind
            )
            return (
              <div key={stage.kind} className='flex flex-col gap-2'>
                <div className='flex items-baseline justify-between gap-2'>
                  <span className='text-muted-foreground text-xs font-medium'>
                    {t(props.stageLabels[stage.kind])}
                  </span>
                  <span className='text-muted-foreground text-xs tabular-nums'>
                    {props.formatMetricValue(stage.total)}
                  </span>
                </div>

                {stage.segments.length === 0 ? (
                  <div className='bg-muted text-muted-foreground flex h-9 items-center justify-center rounded-md border text-xs'>
                    {t('No data available')}
                  </div>
                ) : (
                  <div className='flex h-9 w-full overflow-hidden rounded-md border'>
                    {stage.segments.map((segment) => {
                      if (segment.isOther) {
                        return (
                          <div
                            key={segment.id}
                            className='h-full'
                            style={{
                              width: `${segment.share * 100}%`,
                              backgroundColor: segment.color,
                            }}
                            title={`${segment.label} · ${segmentPercent(segment)}%`}
                          />
                        )
                      }
                      const selected = Boolean(
                        stageFilter && stageFilter.id === segment.id
                      )
                      const dimmed = Boolean(stageFilter) && !selected
                      return (
                        <button
                          key={segment.id}
                          type='button'
                          aria-pressed={selected}
                          aria-label={`${segment.label} ${segmentPercent(segment)}%`}
                          title={`${segment.label} · ${props.formatMetricValue(segment.value)} · ${segmentPercent(segment)}%`}
                          onClick={() => toggleSegment(segment)}
                          className={cn(
                            'relative h-full min-w-[3px] cursor-pointer transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                            dimmed && 'opacity-35',
                            selected && 'ring-2 ring-foreground ring-inset'
                          )}
                          style={{
                            width: `${segment.share * 100}%`,
                            backgroundColor: segment.color,
                          }}
                        />
                      )
                    })}
                  </div>
                )}

                {stage.segments.length > 0 && (
                  <div className='flex flex-wrap items-center gap-x-3 gap-y-1.5'>
                    {stage.segments.map((segment) => {
                      const selected = Boolean(
                        stageFilter && stageFilter.id === segment.id
                      )
                      if (segment.isOther) {
                        return (
                          <span
                            key={segment.id}
                            className='text-muted-foreground inline-flex items-center gap-1 text-xs'
                          >
                            <span
                              className='size-2 rounded-full'
                              style={{ backgroundColor: segment.color }}
                            />
                            {segment.label} {segmentPercent(segment)}%
                          </span>
                        )
                      }
                      return (
                        <button
                          key={segment.id}
                          type='button'
                          aria-pressed={selected}
                          onClick={() => toggleSegment(segment)}
                          className={cn(
                            'inline-flex max-w-[16rem] items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-colors',
                            selected
                              ? 'border-foreground bg-foreground text-background'
                              : 'hover:bg-muted'
                          )}
                        >
                          <span
                            className='size-2 shrink-0 rounded-full'
                            style={{ backgroundColor: segment.color }}
                          />
                          <span className='truncate'>{segment.label}</span>
                          <span className='tabular-nums opacity-70'>
                            {segmentPercent(segment)}%
                          </span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        {isNarrow && shownStages.length < props.stages.length && (
          <p className='text-muted-foreground text-xs'>
            {t('Select a slice to drill into the next stage')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      {activeFilters.length > 0 && (
        <div className='flex flex-wrap items-center gap-1.5'>
          <span className='text-muted-foreground text-xs'>
            {t('Filtered by')}
          </span>
          {activeFilters.map((filter) => (
            <button
              key={`${filter.kind}:${filter.id}`}
              type='button'
              onClick={() =>
                setActiveFilters((prev) =>
                  prev.filter(
                    (item) =>
                      !(item.kind === filter.kind && item.id === filter.id)
                  )
                )
              }
              className='bg-muted inline-flex max-w-[18rem] items-center gap-1 rounded-full px-2 py-0.5 text-xs'
            >
              <span className='text-muted-foreground'>
                {t(props.stageLabels[filter.kind])}
              </span>
              <span className='truncate'>{filterLabel(breakdown, filter)}</span>
              <X className='size-3 shrink-0' aria-hidden='true' />
            </button>
          ))}
          <button
            type='button'
            onClick={() => setActiveFilters([])}
            className='text-muted-foreground hover:text-foreground text-xs underline underline-offset-2'
          >
            {t('Clear all')}
          </button>
        </div>
      )}
      {body}
    </div>
  )
}
