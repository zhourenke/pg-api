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

// Caption order, not drawing order: the legend reads in the order the axes are
// read, while the series are painted bottom-up (see METRIC_DRAW_ORDER).
const METRIC_ORDER: TrendMetricField[] = ['latency', 'speed', 'success']

/**
 * Drawing order, first painted to last: success sits at the bottom because it is
 * the least important of the three and a percentage line is usually flat near
 * the ceiling anyway, latency in the middle, and speed on top so the line the
 * eye follows most keeps its unbroken shape wherever the three cross.
 */
const METRIC_DRAW_ORDER: TrendMetricField[] = ['success', 'latency', 'speed']

/**
 * The point marker is stroked in the colour of the card behind it, not in white:
 * the ring then reads as a gap cut in the lines (including the ones passing
 * underneath) in both themes, and a bright white ring no longer stands out
 * against the dark card. The values are the composited chart backdrop measured
 * per theme - the card at 60% over the drawer, i.e. rgb(42,42,42) over
 * rgb(30,30,30) = #252525 in the dark theme, white on white in the light one.
 * A theme preset that repaints the card would need these re-measured.
 */
const BACKDROP_COLORS: Record<'light' | 'dark', string> = {
  light: '#ffffff',
  dark: '#252525',
}

/**
 * One entry per metric: a hue for each theme, plus a non-colour channel (point
 * shape and dash) so the three lines stay apart for colour-blind readers, in
 * greyscale and on a small chart. Latency and success are the pair that
 * collapses under red-green colour blindness, so those two differ in both
 * channels while speed keeps the plain solid circle. The caption swatch repeats
 * the same hue and shape, so a legend entry cannot disagree with its line.
 */
const METRIC_STYLES: Record<
  TrendMetricField,
  {
    color: { light: string; dark: string }
    symbolType: 'circle' | 'square' | 'triangle'
    dashed: boolean
    /** Swatch shape behind the caption label. */
    swatch: string
  }
> = {
  latency: {
    color: { light: '#ea580c', dark: '#ffb454' },
    symbolType: 'square',
    dashed: false,
    swatch: 'rounded-[1px]',
  },
  speed: {
    color: { light: '#2563eb', dark: '#58a6ff' },
    symbolType: 'circle',
    dashed: false,
    swatch: 'rounded-full',
  },
  success: {
    color: { light: '#059669', dark: '#34d399' },
    symbolType: 'triangle',
    dashed: true,
    swatch: '[clip-path:polygon(50%_0%,100%_100%,0%_100%)]',
  },
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
  let decimals = 2
  if (step >= 1) decimals = 0
  else if (step >= 0.1) decimals = 1
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
  const isDark = resolvedTheme === 'dark'

  // The chart body and the caption swatches share one palette, so the theme
  // picks its variant once per render. The ring around every point is the card
  // colour of the same theme, which is what cuts the lines underneath it.
  const metricColors = useMemo(
    () =>
      Object.fromEntries(
        METRIC_ORDER.map((field) => [
          field,
          METRIC_STYLES[field].color[isDark ? 'dark' : 'light'],
        ])
      ) as Record<TrendMetricField, string>,
    [isDark]
  )
  const backdrop = BACKDROP_COLORS[isDark ? 'dark' : 'light']

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
    const lineStyle = (field: TrendMetricField) => {
      const style = METRIC_STYLES[field]
      const color = metricColors[field]
      return {
        line: {
          style: {
            lineWidth: 2,
            curveType: 'monotone',
            stroke: color,
            lineDash: style.dashed ? [4, 3] : undefined,
          },
        },
        point: {
          visible: true,
          // 6 instead of 5: a square and a triangle need the extra pixel to
          // stay recognisable next to a circle.
          style: {
            size: 6,
            fill: color,
            stroke: backdrop,
            lineWidth: 1.5,
            symbolType: style.symbolType,
          },
        },
      }
    }
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
      color: METRIC_DRAW_ORDER.map((field) => metricColors[field]),
      data: METRIC_DRAW_ORDER.map((field) => ({
        id: `trend-${field}`,
        values: buildValues(field),
      })),
      series: METRIC_DRAW_ORDER.map((field) => ({
        id: field,
        name: labels[field],
        type: 'line' as const,
        dataId: `trend-${field}`,
        xField: 'hour',
        yField: 'value',
        invalidType: 'break' as const,
        ...lineStyle(field),
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
      // The band axis marks the hovered hour, the same rect crosshair the
      // previous latency chart showed.
      crosshair: {
        xField: {
          visible: true,
          line: { visible: true, type: 'rect' as const },
        },
      },
      tooltip: {
        // `dimension` shows all three metrics for the hovered hour, and the
        // click trigger keeps touch taps from dismissing it immediately.
        activeType: ['dimension'],
        trigger: ['hover', 'click'],
        // The panel must stay transparent to pointers: with an enterable
        // tooltip a fast cursor (or a tap) that lands on the panel freezes the
        // highlight instead of reporting the hour under the pointer.
        enterable: false,
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
      theme: isDark ? 'dark' : 'light',
      background: 'transparent',
    }
  }, [backdrop, domains, isDark, labels, metricColors, props.slots])

  return (
    <div className={cn('space-y-2', props.className)}>
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1'>
        {METRIC_ORDER.map((field) => (
          <span key={field} className='flex items-center gap-1.5 text-[11px]'>
            <span
              aria-hidden
              data-metric={field}
              className={cn('size-2 shrink-0', METRIC_STYLES[field].swatch)}
              style={{ backgroundColor: metricColors[field] }}
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
