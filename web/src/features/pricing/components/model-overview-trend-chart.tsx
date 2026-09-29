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
import { VChart } from '@visactor/react-vchart'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
} from '@/features/performance-metrics/lib/format'
import { useChartTheme } from '@/lib/use-chart-theme'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

/** One hour of the fixed 24-hour window; a null metric means "no traffic". */
export type TrendSlot = {
  hour: string
  fullTime: string
  latency: number | null
  speed: number | null
  success: number | null
}

type TrendMetricField = 'latency' | 'speed' | 'success'

type TrendDatum = {
  hour: string
  fullTime: string
  metric: string
  value: number | null
  text: string
}

/** Every value axis starts at zero, so the scale needs its own upper bound. */
type AxisDomain = {
  max: number
  /** Label text such as `0-1.5 s` or `0-80%`; the unit keeps its own spacing. */
  text: string
}

// Palette order matches the series order; the caption swatches reuse it.
const METRIC_ORDER: TrendMetricField[] = ['latency', 'speed', 'success']

const METRIC_COLORS: Record<TrendMetricField, string> = {
  latency: '#3b82f6',
  speed: '#a855f7',
  success: '#10b981',
}

const METRIC_FORMATTERS: Record<TrendMetricField, (value: number) => string> = {
  latency: formatLatency,
  speed: formatThroughput,
  success: formatUptimePct,
}

// The unit a value axis is measured in; the percent sign keeps no leading space.
const METRIC_UNITS: Record<TrendMetricField, string> = {
  latency: ' s',
  speed: ' t/s',
  success: '%',
}

// Used only when a metric has no sample at all in the window.
const METRIC_FALLBACK_MAX: Record<TrendMetricField, number> = {
  latency: 10,
  speed: 100,
  success: 100,
}

const TARGET_GRID_LINES = 5

/**
 * Smallest 1/2/5 x 10^n step that is at least `raw`. The precision follows the
 * magnitude, so a 0.4 t/s peak gets a 0.1 step while a 147 t/s peak gets 50.
 */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  for (const multiplier of [1, 2, 5]) {
    const candidate = multiplier * magnitude
    if (candidate >= raw) return candidate
  }
  return 10 * magnitude
}

function domainText(field: TrendMetricField, max: number, step: number) {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2
  return `0-${max.toFixed(decimals)}${METRIC_UNITS[field]}`
}

// The latency axis is in seconds; every other metric plots its own unit.
function axisValue(field: TrendMetricField, raw: number | null): number {
  if (raw == null) return Number.NaN
  return field === 'latency' ? raw / 1000 : raw
}

/**
 * Zero-based axis domain whose top sits just above the largest sample, keeping
 * the points spread over the full height instead of bunched on one line.
 */
function buildAxisDomain(
  field: TrendMetricField,
  values: number[]
): AxisDomain {
  const samples = values.filter((value) => Number.isFinite(value))
  const peak = samples.length === 0 ? 0 : Math.max(...samples)
  if (peak <= 0) {
    const fallback = METRIC_FALLBACK_MAX[field]
    return { max: fallback, text: domainText(field, fallback, fallback / 5) }
  }
  const step = niceStep(peak / TARGET_GRID_LINES)
  const max = Math.max(step, Math.ceil(peak / step) * step)
  return { max, text: domainText(field, max, step) }
}

export interface ModelOverviewTrendChartProps {
  slots: TrendSlot[]
  className?: string
}

export function ModelOverviewTrendChart(props: ModelOverviewTrendChartProps) {
  const { t } = useTranslation()
  const { resolvedTheme, themeReady } = useChartTheme()

  const labels = useMemo(
    () => ({
      latency: t('First token latency'),
      speed: t('Model speed'),
      success: t('Success rate'),
      noData: t('No data for this hour'),
    }),
    [t]
  )

  // Zero-based domains drive both the axes and the legend ranges.
  const domains = useMemo(() => {
    const samplesOf = (field: TrendMetricField) =>
      props.slots.map((slot) => axisValue(field, slot[field]))
    return Object.fromEntries(
      METRIC_ORDER.map((field) => [
        field,
        buildAxisDomain(field, samplesOf(field)),
      ])
    ) as Record<TrendMetricField, AxisDomain>
  }, [props.slots])

  const spec = useMemo(() => {
    const isDark = resolvedTheme === 'dark'
    // VChart themes cover the chart body; the hour labels keep the same muted
    // tone the previous charts used so both themes stay legible.
    const labelStyle = {
      fill: isDark ? 'rgba(255, 255, 255, 0.68)' : 'rgba(15, 23, 42, 0.58)',
      fontSize: 10,
    }
    const buildValues = (field: TrendMetricField): TrendDatum[] =>
      props.slots.map((slot) => {
        const raw = slot[field]
        return {
          hour: slot.hour,
          fullTime: slot.fullTime,
          metric: labels[field],
          // The tooltip keeps the shared formatter, so a sub-second sample
          // still reads as milliseconds even though the axis uses seconds.
          value: raw == null ? null : axisValue(field, raw),
          text: raw == null ? labels.noData : METRIC_FORMATTERS[field](raw),
        }
      })
    const lineStyle = (color: string) => ({
      line: { style: { lineWidth: 2, curveType: 'monotone', stroke: color } },
      point: {
        visible: true,
        style: { size: 5, fill: color, stroke: '#ffffff', lineWidth: 1.5 },
      },
    })
    // The tick labels are gone, so each axis only keeps its bound and grid.
    const valueAxis = (
      field: TrendMetricField,
      domain: AxisDomain,
      showGrid: boolean
    ) => ({
      orient: field === 'latency' ? 'left' : 'right',
      type: 'linear' as const,
      seriesId: field,
      min: 0,
      max: domain.max,
      label: { visible: false },
      tick: { visible: false },
      grid: showGrid
        ? {
            visible: true,
            style: {
              lineDash: [3, 3],
              stroke: isDark
                ? 'rgba(255, 255, 255, 0.12)'
                : 'rgba(15, 23, 42, 0.12)',
            },
          }
        : { visible: false },
    })
    const latencyDomain = domains.latency
    const speedDomain = domains.speed
    const successDomain = domains.success

    return {
      type: 'common' as const,
      color: METRIC_ORDER.map((field) => METRIC_COLORS[field]),
      data: METRIC_ORDER.map((field) => ({
        id: `trend-${field}`,
        values: buildValues(field),
      })),
      series: METRIC_ORDER.map((field) => ({
        id: field,
        name: labels[field],
        type: 'line' as const,
        dataId: `trend-${field}`,
        xField: 'hour',
        yField: 'value',
        invalidType: 'break' as const,
        ...lineStyle(METRIC_COLORS[field]),
      })),
      axes: [
        {
          orient: 'bottom',
          type: 'band',
          // Every hour of the window stays on the axis, including idle ones.
          domain: props.slots.map((slot) => slot.hour),
          tick: { visible: false },
          grid: { visible: false },
          label: { style: labelStyle },
        },
        valueAxis('latency', latencyDomain, true),
        valueAxis('speed', speedDomain, false),
        valueAxis('success', successDomain, false),
      ],
      legends: { visible: false },
      tooltip: {
        // `dimension` shows all three metrics for the hovered hour, and the
        // click trigger keeps touch taps from dismissing it immediately.
        activeType: ['dimension'],
        trigger: ['hover', 'click'],
        enterable: true,
        dimension: {
          title: { value: (datum: TrendDatum) => datum?.fullTime },
          content: [
            {
              key: (datum: TrendDatum) => datum?.metric,
              value: (datum: TrendDatum) => datum?.text,
            },
          ],
        },
      },
      theme: resolvedTheme === 'dark' ? 'dark' : 'light',
      background: 'transparent',
    }
  }, [domains, labels, props.slots, resolvedTheme])

  return (
    <div className={cn('space-y-2', props.className)}>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
        {METRIC_ORDER.map((field) => (
          <span key={field} className='flex items-center gap-1.5 text-[11px]'>
            <span
              aria-hidden
              className='size-2 shrink-0 rounded-full'
              style={{ backgroundColor: METRIC_COLORS[field] }}
            />
            <span className='text-muted-foreground'>{labels[field]}</span>
            <span className='text-foreground/75 font-mono tabular-nums'>
              {domains[field].text}
            </span>
          </span>
        ))}
      </div>
      <div className='h-52 sm:h-64'>
        {themeReady && (
          <VChart
            key={`trend-${resolvedTheme}`}
            spec={spec}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </div>
  )
}
