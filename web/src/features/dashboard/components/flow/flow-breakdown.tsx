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
  formatMetricValue: (value: number) => string
}

// Match the usage-log table so the inline numbers read at the same size now that
// they are no longer tucked into a hover tooltip.
const CHIP_TEXT = 'text-[13px]'

function findSegment(
  breakdown: FlowBreakdown,
  filter: FlowNodeFilter
): FlowBreakdownSegment | undefined {
  const stage = breakdown.stages.find((item) => item.kind === filter.kind)
  return stage?.segments.find((segment) => segment.id === filter.id)
}

function segmentPercent(segment: FlowBreakdownSegment): number {
  return Math.round(segment.share * 100)
}

export function FlowBreakdown(props: FlowBreakdownProps) {
  const { t } = useTranslation()
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

  // A stage whose cross-filtered total is zero has nothing to draw, but a stage
  // of the dimension the user just picked ignores its own filter, so at least
  // that stage keeps its values. Only treat the whole card as empty when no
  // stage has anything to show and no filter is pinning the view.
  const hasValues = breakdown.stages.some((stage) => stage.total > 0)

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
  } else if (!hasValues && activeFilters.length === 0) {
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
      <div className='flex flex-col gap-4'>
        {breakdown.stages.map((stage) => {
          const stageFilter = activeFilters.find(
            (filter) => filter.kind === stage.kind
          )
          const selectedSegment = stageFilter
            ? stage.segments.find((segment) => segment.id === stageFilter.id)
            : undefined
          return (
            <div key={stage.kind} className='flex flex-col gap-1.5'>
              <div className='flex items-baseline justify-between gap-2'>
                <span
                  className={cn('text-muted-foreground font-medium', CHIP_TEXT)}
                >
                  {t(props.stageLabels[stage.kind])}
                </span>
                <span className={cn('tabular-nums', CHIP_TEXT)}>
                  {selectedSegment ? (
                    <>
                      <span className='text-foreground'>
                        {props.formatMetricValue(selectedSegment.value)}
                      </span>
                      <span className='text-muted-foreground'>
                        {' / '}
                        {props.formatMetricValue(stage.total)}
                      </span>
                    </>
                  ) : (
                    <span className='text-muted-foreground'>
                      {props.formatMetricValue(stage.total)}
                    </span>
                  )}
                </span>
              </div>

              {stage.segments.length === 0 || stage.total <= 0 ? (
                <div
                  className={cn(
                    'bg-muted text-muted-foreground flex h-9 items-center justify-center rounded-md border',
                    CHIP_TEXT
                  )}
                >
                  {t('No data available')}
                </div>
              ) : (
                // Round the outer edges on the end slices instead of clipping the
                // row with overflow-hidden: a clip shaves any slice narrower than
                // the corner radius into a lopsided wedge. The end slices also get
                // a minimum width equal to the corner diameter, so a near-zero
                // slice at the edge still has room for its radius instead of
                // collapsing into a square corner.
                <div
                  data-testid='flow-breakdown-bar'
                  className='flex h-9 w-full rounded-md border'
                >
                  {stage.segments.map((segment) => {
                    const edgeClasses =
                      'first:min-w-[10px] first:rounded-l-[5px] last:min-w-[10px] last:rounded-r-[5px]'
                    if (segment.isOther) {
                      return (
                        <div
                          key={segment.id}
                          className={cn('h-full', edgeClasses)}
                          style={{
                            width: `${segment.share * 100}%`,
                            backgroundColor: segment.color,
                          }}
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
                        aria-label={`${segment.label} ${props.formatMetricValue(segment.value)} ${segmentPercent(segment)}%`}
                        onClick={() => toggleSegment(segment)}
                        className={cn(
                          'relative h-full cursor-pointer transition-opacity focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset',
                          edgeClasses,
                          dimmed && 'opacity-35',
                          // A selected slice with (almost) no usage would be a
                          // zero-width sliver; keep a hair of width so its ring
                          // still marks the pick.
                          selected &&
                            'min-w-[3px] ring-2 ring-foreground ring-inset'
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

              {/* Always render the legend row, even for a stage whose filtered
                  total is zero: keeping the fixed-height row stops the whole
                  card from collapsing when a zero-usage slice is selected. */}
              <div className='flex h-8 items-center gap-3 overflow-x-auto whitespace-nowrap'>
                {stage.segments.map((segment) => {
                  const selected = Boolean(
                    stageFilter && stageFilter.id === segment.id
                  )
                  if (segment.isOther) {
                    return (
                      <span
                        key={segment.id}
                        className={cn(
                          'text-muted-foreground inline-flex shrink-0 items-center gap-1',
                          CHIP_TEXT
                        )}
                      >
                        <span
                          className='size-2 rounded-full'
                          style={{ backgroundColor: segment.color }}
                        />
                        {segment.label}
                        <span className='tabular-nums opacity-80'>
                          {props.formatMetricValue(segment.value)}
                        </span>
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
                        'inline-flex max-w-[18rem] shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 transition-colors',
                        CHIP_TEXT,
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
                      <span className='tabular-nums opacity-80'>
                        {props.formatMetricValue(segment.value)}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex h-8 min-w-0 items-center gap-1.5 overflow-x-auto whitespace-nowrap'>
        {activeFilters.length === 0 ? (
          <span className={cn('text-muted-foreground', CHIP_TEXT)}>
            {t('Tap any slice to filter and see its usage here')}
          </span>
        ) : (
          <>
            <span className={cn('text-muted-foreground shrink-0', CHIP_TEXT)}>
              {t('Filtered by')}
            </span>
            {activeFilters.map((filter) => {
              const segment = findSegment(breakdown, filter)
              return (
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
                  className={cn(
                    'bg-muted inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5',
                    CHIP_TEXT
                  )}
                >
                  <span className='text-muted-foreground'>
                    {t(props.stageLabels[filter.kind])}
                  </span>
                  <span className='max-w-[12rem] truncate'>
                    {segment?.label ?? filter.id}
                  </span>
                  <X className='size-3 shrink-0' aria-hidden='true' />
                </button>
              )
            })}
            <button
              type='button'
              onClick={() => setActiveFilters([])}
              className={cn(
                'text-muted-foreground hover:text-foreground shrink-0 underline underline-offset-2',
                CHIP_TEXT
              )}
            >
              {t('Clear all')}
            </button>
          </>
        )}
      </div>
      {body}
    </div>
  )
}
