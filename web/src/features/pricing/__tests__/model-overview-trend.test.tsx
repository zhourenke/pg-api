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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import type {
  PerformanceGroup,
  PerformanceSeriesPoint,
} from '@/features/performance-metrics/types'

import { ModelOverviewTrend } from '../components/model-overview-trend'

type TrendMetricField = 'latency' | 'speed' | 'success'

type TrendDatumLike = {
  hour: string
  fullTime: string
  metric: string
  value: number | null
  text: string
}

/** A marker style is a callback: the chart computes it per data point. */
type MarkerCallback = (
  datum: TrendDatumLike,
  ctx: Record<string, unknown>
) => number

type CapturedSpec = {
  color?: string[]
  data: Array<{ id: string; values: TrendDatumLike[] }>
  series: Array<{
    id: string
    invalidType?: string
    line?: { style?: { stroke?: string; lineDash?: number[] } }
    point?: {
      style?: {
        fill?: string
        stroke?: string
        size?: number
        symbolType?: string
        angle?: MarkerCallback
        dx?: MarkerCallback
        dy?: MarkerCallback
      }
    }
  }>
  axes: Array<{
    orient: string
    domain?: string[]
    seriesId?: string
    min?: number
    max?: number
    label?: { visible?: boolean }
  }>
  crosshair?: {
    followTooltip?: boolean
    xField?: { visible?: boolean; line?: { visible?: boolean; type?: string } }
  }
  tooltip: {
    enterable?: boolean
    dimension: {
      title: { value: (datum: TrendDatumLike) => string }
      content: Array<{
        key: (datum: TrendDatumLike) => string
        value: (datum: TrendDatumLike) => string
      }>
    }
  }
  theme?: string
}

const chart = vi.hoisted(() => vi.fn((_props: { spec: CapturedSpec }) => null))
vi.mock('@visactor/react-vchart', () => ({ VChart: chart }))
vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

const HOUR = 3600
// 00:00 local time keeps the expected hour labels deterministic.
const WINDOW_START = Math.floor(
  new Date(2026, 8, 28, 0, 0, 0, 0).getTime() / 1000
)

function hourPoint(
  offsetHours: number,
  overrides: Partial<PerformanceSeriesPoint> = {}
): PerformanceSeriesPoint {
  return {
    ts: WINDOW_START + offsetHours * HOUR,
    avg_ttft_ms: 1200,
    avg_latency_ms: 1500,
    success_rate: 98.22,
    avg_tps: 42,
    ...overrides,
  }
}

function trendGroup(
  overrides: Partial<PerformanceGroup> = {}
): PerformanceGroup {
  return {
    group: 'default',
    avg_ttft_ms: 1200,
    avg_latency_ms: 1500,
    success_rate: 98.22,
    avg_tps: 42,
    series: [],
    ...overrides,
  }
}

/**
 * 05:00 to 07:00 with a flat first-token latency and a climb in the other two,
 * each at its own rate, so a marker can only be right about all three if it
 * measures its own axis in pixels.
 */
function climbingSeries(): PerformanceSeriesPoint[] {
  return [
    hourPoint(5, { avg_ttft_ms: 1000, avg_tps: 20, success_rate: 10 }),
    hourPoint(6, { avg_ttft_ms: 1000, avg_tps: 40, success_rate: 20 }),
    hourPoint(7, { avg_ttft_ms: 1000, avg_tps: 60, success_rate: 30 }),
  ]
}

/** The mark context VChart builds for a cartesian series: 10px per hour and per unit, y down. */
function pixelContext(hours: string[]) {
  const indexOfHour = new Map(hours.map((hour, index) => [hour, index]))
  return {
    valueToX: (hour: string) => (indexOfHour.get(hour) ?? 0) * 10,
    valueToY: (value: number) => 200 - value * 10,
  }
}

/** The data point a marker callback is called with, at one hour of the window. */
function datumAt(
  spec: CapturedSpec,
  metric: TrendMetricField,
  index: number
): TrendDatumLike {
  const row = spec.data.find((entry) => entry.id === `trend-${metric}`)
  if (!row) throw new Error(`no data row for ${metric}`)
  return row.values[index]
}

function renderTrend(
  groups: PerformanceGroup[],
  theme: 'light' | 'dark' = 'light'
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  client.setQueryData(['perf-metrics', 'test-model'], {
    success: true,
    data: {
      model_name: 'test-model',
      window_start: WINDOW_START,
      window_end: WINDOW_START + 23 * HOUR,
      groups,
    },
  })

  return render(
    <ThemeProvider defaultTheme={theme}>
      <QueryClientProvider client={client}>
        <ModelOverviewTrend
          model={{
            id: 1,
            model_name: 'test-model',
            quota_type: 0,
            model_ratio: 1,
            completion_ratio: 1,
            enable_groups: ['default'],
          }}
        />
      </QueryClientProvider>
    </ThemeProvider>
  )
}

async function capturedSpecs(): Promise<CapturedSpec[]> {
  await waitFor(() => expect(chart).toHaveBeenCalled())
  return chart.mock.calls.map(([props]) => props.spec)
}

/** The legend swatch of one metric, read back from its inline colour. */
function swatchColor(metric: TrendMetricField): string {
  return swatchOf(metric)?.style.backgroundColor ?? ''
}

/** The legend swatch's class list, which is where its shape lives. */
function swatchClass(metric: TrendMetricField): string {
  return swatchOf(metric)?.className ?? ''
}

function swatchOf(metric: TrendMetricField): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-metric="${metric}"]`)
}

type CapturedSeries = CapturedSpec['series'][number]

/** Series styles keyed by metric, so an assertion never depends on draw order. */
function byMetric<T>(
  spec: CapturedSpec,
  pick: (series: CapturedSeries) => T
): Record<string, T> {
  return Object.fromEntries(spec.series.map((entry) => [entry.id, pick(entry)]))
}

/** jsdom serializes an inline colour as `rgb(...)`, so both sides normalize. */
function toCssColor(value: string): string {
  const probe = document.createElement('span')
  probe.style.backgroundColor = value
  return probe.style.backgroundColor
}

it('keeps all 24 hours on the axis and breaks the line on idle hours', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [hourPoint(5)],
    }),
  ])

  const [spec] = await capturedSpecs()
  const latency = spec.data.find((entry) => entry.id === 'trend-latency')
  expect(latency?.values).toHaveLength(24)
  expect(latency?.values[5].value).toBe(1.2)
  expect(latency?.values[4].value).toBeNull()
  expect(spec.axes[0].domain).toHaveLength(24)
  expect(spec.axes[0].domain?.[0]).toBe('00:00')
  expect(spec.axes[0].domain?.[23]).toBe('23:00')
  expect(spec.series.map((entry) => entry.invalidType)).toEqual([
    'break',
    'break',
    'break',
  ])
})

it('starts every value axis at zero and keeps only the hour labels', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [hourPoint(5, { success_rate: 80 })],
    }),
  ])

  const [spec] = await capturedSpecs()
  expect(spec.axes.map((axis) => [axis.orient, axis.seriesId])).toEqual([
    ['bottom', undefined],
    ['left', 'latency'],
    ['right', 'speed'],
    ['right', 'success'],
  ])
  expect(spec.axes[1].min).toBe(0)
  expect(spec.axes[1].max).toBe(1.5)
  expect(spec.axes[2].min).toBe(0)
  expect(spec.axes[2].max).toBe(50)
  expect(spec.axes[3].min).toBe(0)
  expect(spec.axes[3].max).toBe(80)
  expect(spec.axes[3].label?.visible).toBe(false)
  expect(spec.axes[0].label?.visible).toBeUndefined()
})

it('marks the hovered hour and keeps the tooltip out of the pointer path', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  expect(spec.crosshair?.xField?.visible).toBe(true)
  expect(spec.crosshair?.xField?.line).toMatchObject({
    visible: true,
    type: 'rect',
  })
  // An enterable panel becomes a hit target, so a fast cursor or a tap that
  // lands on it freezes the highlight instead of reporting the hour below.
  expect(spec.tooltip.enterable).toBe(false)
})

it('drives the highlight from the label so that a tap moves it too', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  // A crosshair of its own listens to hover, and the mode this chart runs in
  // defines hover as `pointermove` - which a tap never emits, so the column sat
  // still while the label followed every tap. Bound to the tooltip the two share
  // one source of truth instead.
  expect(spec.crosshair?.followTooltip).toBe(true)
})

it('keeps the hour a finger picked and still lets a mouse leave the plot', async () => {
  chart.mockClear()
  const { container } = renderTrend([trendGroup({ series: [hourPoint(5)] })])
  await capturedSpecs()

  // The stubbed VChart paints nothing, so the test supplies the element the real
  // one puts inside the plot: what matters is that it sits below the box the
  // component guards.
  const plot = container.querySelector('.h-52')
  expect(plot).not.toBeNull()
  const canvas = document.createElement('div')
  plot?.appendChild(canvas)
  const reached: Array<string | undefined> = []
  canvas.addEventListener('pointerleave', (event) => {
    reached.push((event as PointerEvent).pointerType)
  })

  // A raised finger emits pointerleave right after pointerup; letting that
  // through is what closed the tooltip the moment the user let go.
  fireEvent.pointerLeave(canvas, { pointerType: 'touch' })
  expect(reached).toEqual([])
  fireEvent.pointerLeave(canvas, { pointerType: 'mouse' })
  expect(reached).toEqual(['mouse'])
})

it('writes each range into the legend with the metric unit', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [hourPoint(5, { success_rate: 80 })],
    }),
  ])

  await capturedSpecs()
  expect(screen.getByText('0-1.5 s')).toBeVisible()
  expect(screen.getByText('0-50 t/s')).toBeVisible()
  expect(screen.getByText('0-80%')).toBeVisible()
})

it.each([
  {
    theme: 'light' as const,
    colors: { latency: '#ea580c', speed: '#2563eb', success: '#059669' },
  },
  {
    theme: 'dark' as const,
    colors: { latency: '#ffb454', speed: '#58a6ff', success: '#34d399' },
  },
])(
  'paints latency, speed and success with the $theme palette',
  async ({ theme, colors }) => {
    chart.mockClear()
    renderTrend([trendGroup({ series: [hourPoint(5)] })], theme)

    const [spec] = await capturedSpecs()
    expect(spec.theme).toBe(theme)
    // By metric rather than by position: the drawing order is its own contract
    // and is pinned separately below.
    expect(byMetric(spec, (series) => series.line?.style?.stroke)).toEqual(
      colors
    )
    expect(spec.color).toEqual(
      spec.series.map((entry) => colors[entry.id as TrendMetricField])
    )
    // A swatch is the only thing tying a line to its label, so it has to carry
    // the colour of the series it names.
    const fields: TrendMetricField[] = ['latency', 'speed', 'success']
    expect(fields.map(swatchColor)).toEqual(
      fields.map((field) => toCssColor(colors[field]))
    )
    // Hue is not the only channel: rendering the chart in greyscale, or losing
    // the red-green axis, still has to leave three tellable lines.
    const swatchClasses = fields.map(swatchClass)
    expect(new Set(swatchClasses).size).toBe(fields.length)
  }
)

it.each([
  { theme: 'light' as const, ring: '#ffffff' },
  { theme: 'dark' as const, ring: '#252525' },
])(
  'strokes every point with the $theme card colour, not white',
  async ({ theme, ring }) => {
    chart.mockClear()
    renderTrend([trendGroup({ series: [hourPoint(5)] })], theme)

    const [spec] = await capturedSpecs()
    expect(byMetric(spec, (series) => series.point?.style?.stroke)).toEqual({
      latency: ring,
      speed: ring,
      success: ring,
    })
  }
)

it('gives every metric its own point shape and dash', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  expect(byMetric(spec, (series) => series.point?.style?.symbolType)).toEqual({
    latency: 'square',
    speed: 'circle',
    success: 'triangle',
  })
  // Only success is dashed, so the latency/success pair - the one that
  // collapses under red-green colour blindness - differs twice over.
  expect(byMetric(spec, (series) => series.line?.style?.lineDash)).toEqual({
    latency: undefined,
    speed: undefined,
    success: [4, 3],
  })
})

it('sizes each marker so the three shapes paint the same amount of ink', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  // `size` is a bounding-box edge, not an area: the square fills its box, the
  // circle paints pi/4 of it and the triangle half, and the 1.5px ring then eats
  // inward from all sides. These three values are the measured equal-ink
  // solution, so they move together - never change one of them alone.
  expect(byMetric(spec, (series) => series.point?.style?.size)).toEqual({
    latency: 5.7,
    speed: 6,
    success: 8.5,
  })
})

it('gives the legend swatches equal ink instead of one shared box', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  await capturedSpecs()
  // The swatch is a span whose edge lives in its size class.
  const edgeOf = (metric: TrendMetricField) => {
    const match = swatchClass(metric).match(/size-\[([\d.]+)px\]/)
    if (!match) throw new Error(`no swatch size for ${metric}`)
    return Number(match[1])
  }
  // A triangle fills half of its box and a circle pi/4 of it, so one box for all
  // three would leave the triangle at half the square's ink - which is exactly
  // what made it read as the smallest of the three.
  const ink: Record<TrendMetricField, number> = {
    latency: edgeOf('latency') ** 2,
    speed: (Math.PI * edgeOf('speed') ** 2) / 4,
    success: edgeOf('success') ** 2 / 2,
  }
  expect(Math.abs(ink.speed - ink.latency) / ink.latency).toBeLessThan(0.02)
  expect(Math.abs(ink.success - ink.latency) / ink.latency).toBeLessThan(0.02)
})

it('turns every marker to the pixel slope of its own line', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: climbingSeries() })])

  const [spec] = await capturedSpecs()
  const ctx = pixelContext(spec.axes[0].domain ?? [])
  const styles = byMetric(spec, (series) => series.point?.style)
  const angleAt = (metric: TrendMetricField) =>
    styles[metric]?.angle?.(datumAt(spec, metric, 6), ctx)
  // A mark's `angle` travels through VChart as degrees and only becomes the
  // radians vrender turns by on its way to the graphic, so a slope has to be
  // converted here. Feeding it radians turns the marker by 1/57 of the line.
  const asDegrees = (radians: number) => (radians * 180) / Math.PI

  // A flat line leaves the marker in the orientation it was designed in; the
  // other two climb at their own rate, so their tilts differ too. Both chords
  // span two hours: 40 t/s over 20px is steeper than 20 points of success.
  expect(angleAt('latency')).toBe(0)
  expect(angleAt('speed')).toBeCloseTo(asDegrees(Math.atan2(-400, 20)), 10)
  expect(angleAt('success')).toBeCloseTo(asDegrees(Math.atan2(-200, 20)), 10)
})

it('measures the tilt of a marker across an idle hour, not into it', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [
        hourPoint(5, { success_rate: 10 }),
        hourPoint(7, { success_rate: 30 }),
      ],
    }),
  ])

  const [spec] = await capturedSpecs()
  const ctx = pixelContext(spec.axes[0].domain ?? [])
  const style = byMetric(spec, (series) => series.point?.style).success
  // 06:00 has no sample, so the chord runs from 05:00 to 07:00. Reading into the
  // gap instead would leave this marker upright while the line around it climbs.
  expect(style?.angle?.(datumAt(spec, 'success', 7), ctx)).toBeCloseTo(
    (Math.atan2(-200, 20) * 180) / Math.PI,
    10
  )
})

it("puts the triangle's centre of area on the line and leaves the other markers centred", async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: climbingSeries() })])

  const [spec] = await capturedSpecs()
  const ctx = pixelContext(spec.axes[0].domain ?? [])
  const styles = byMetric(spec, (series) => series.point?.style)

  for (const metric of ['latency', 'speed', 'success'] as TrendMetricField[]) {
    const style = styles[metric]
    const datum = datumAt(spec, metric, 6)
    const angle = style?.angle?.(datum, ctx) ?? 0
    const dx = style?.dx?.(datum, ctx) ?? 0
    const dy = style?.dy?.(datum, ctx) ?? 0
    // Where the shape's centre of area ends up relative to the data point: its
    // offset inside the box, turned with the marker and moved by the shift. A
    // triangle's centroid is a sixth of the box below the box centre, and a
    // square's or a circle's is that centre. The turn is the radian angle
    // VChart ends up rotating by, not the degree value it is handed.
    const radians = (angle * Math.PI) / 180
    const centroidShift = metric === 'success' ? (style?.size ?? 0) / 6 : 0
    expect(dx - centroidShift * Math.sin(radians)).toBeCloseTo(0, 10)
    expect(dy + centroidShift * Math.cos(radians)).toBeCloseTo(0, 10)
  }
})

it('keeps the markers upright when the series exposes no pixel converters', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: climbingSeries() })])

  const [spec] = await capturedSpecs()
  const styles = byMetric(spec, (series) => series.point?.style)
  const datum = datumAt(spec, 'success', 6)
  // A context without valueToX/valueToY is a degradation, not a crash: the
  // marker stays in its designed orientation, and the triangle keeps the
  // correction that needs no geometry at all.
  expect(styles.success?.angle?.(datum, {})).toBe(0)
  expect(styles.success?.dx?.(datum, {})).toBe(0)
  expect(styles.success?.dy?.(datum, {})).toBeCloseTo(-8.5 / 6, 10)
})

it('draws speed last and success first so the blue line stays whole', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  expect(spec.series.map((entry) => entry.id)).toEqual([
    'success',
    'latency',
    'speed',
  ])
  expect(spec.data.map((entry) => entry.id)).toEqual([
    'trend-success',
    'trend-latency',
    'trend-speed',
  ])
  // The caption keeps the reading order of the axes, not the painting order.
  expect(
    [...document.querySelectorAll('[data-metric]')].map((node) =>
      node.getAttribute('data-metric')
    )
  ).toEqual(['latency', 'speed', 'success'])
})

it('keeps a usable range when a metric has no sample in the window', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [hourPoint(5, { avg_ttft_ms: 0 })],
    }),
  ])

  await capturedSpecs()
  expect(screen.getByText('0-10 s')).toBeVisible()
})

it('formats every tooltip row and reports the idle hours', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({
      series: [hourPoint(5)],
    }),
  ])

  const [spec] = await capturedSpecs()
  const content = spec.tooltip.dimension.content[0]
  const rows = Object.fromEntries(
    spec.data.map((entry) => [entry.id, entry.values])
  )
  const latencyRow = rows['trend-latency'][5]
  const speedRow = rows['trend-speed'][5]
  const successRow = rows['trend-success'][5]

  expect(content.key(latencyRow)).toBe('First token latency')
  expect(content.value(latencyRow)).toBe('1.20 s')
  expect(content.value(speedRow)).toBe('42.0 t/s')
  expect(content.value(successRow)).toBe('98.22%')
  expect(content.value(rows['trend-latency'][4])).toBe('No data for this hour')
  expect(spec.tooltip.dimension.title.value(latencyRow)).toBe(
    '2026-09-28 05:00'
  )
})

it('renders one chart card per group', async () => {
  chart.mockClear()
  renderTrend([
    trendGroup({ series: [hourPoint(5)] }),
    trendGroup({ group: 'premium', series: [hourPoint(5)] }),
  ])

  const specs = await capturedSpecs()
  expect(specs).toHaveLength(2)
  expect(screen.getByText('default')).toBeVisible()
  expect(screen.getByText('premium')).toBeVisible()
  expect(screen.getAllByText('Last 24 hours')).toHaveLength(2)
})

it('replaces a group chart with a placeholder when the window has no samples', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [] })])

  expect(screen.getByText('No data available')).toBeVisible()
  expect(chart).not.toHaveBeenCalled()
})

it('shows the empty state when the model has no performance groups', async () => {
  chart.mockClear()
  renderTrend([])

  expect(screen.getByText('No data available')).toBeVisible()
  expect(
    screen.getByText('Performance data is not yet available for this model.')
  ).toBeVisible()
  expect(chart).not.toHaveBeenCalled()
})
