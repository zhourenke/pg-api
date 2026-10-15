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
import { render, screen, waitFor } from '@testing-library/react'
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

type CapturedSpec = {
  color?: string[]
  data: Array<{ id: string; values: TrendDatumLike[] }>
  series: Array<{
    id: string
    invalidType?: string
    line?: { style?: { stroke?: string; lineDash?: number[] } }
    point?: { style?: { fill?: string; symbolType?: string } }
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
  { theme: 'light' as const, colors: ['#ea580c', '#2563eb', '#059669'] },
  { theme: 'dark' as const, colors: ['#ffb454', '#58a6ff', '#34d399'] },
])(
  'paints latency, speed and success with the $theme palette',
  async ({ theme, colors }) => {
    chart.mockClear()
    renderTrend([trendGroup({ series: [hourPoint(5)] })], theme)

    const [spec] = await capturedSpecs()
    expect(spec.theme).toBe(theme)
    expect(spec.color).toEqual(colors)
    expect(spec.series.map((entry) => entry.line?.style?.stroke)).toEqual(
      colors
    )
    // A swatch is the only thing tying a line to its label, so it has to carry
    // the colour of the series it names.
    const fields: TrendMetricField[] = ['latency', 'speed', 'success']
    expect(fields.map(swatchColor)).toEqual(colors.map(toCssColor))
    // Hue is not the only channel: rendering the chart in greyscale, or losing
    // the red-green axis, still has to leave three tellable lines.
    const swatchClasses = fields.map(swatchClass)
    expect(new Set(swatchClasses).size).toBe(fields.length)
  }
)

it('gives every metric its own point shape and dash', async () => {
  chart.mockClear()
  renderTrend([trendGroup({ series: [hourPoint(5)] })])

  const [spec] = await capturedSpecs()
  expect(spec.series.map((entry) => entry.point?.style?.symbolType)).toEqual([
    'square',
    'circle',
    'triangle',
  ])
  // Only success is dashed, so the latency/success pair - the one that
  // collapses under red-green colour blindness - differs twice over.
  expect(spec.series.map((entry) => entry.line?.style?.lineDash)).toEqual([
    undefined,
    undefined,
    [4, 3],
  ])
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
  const latencyRow = spec.data[0].values[5]
  const speedRow = spec.data[1].values[5]
  const successRow = spec.data[2].values[5]

  expect(content.key(latencyRow)).toBe('First token latency')
  expect(content.value(latencyRow)).toBe('1.20 s')
  expect(content.value(speedRow)).toBe('42.0 t/s')
  expect(content.value(successRow)).toBe('98.22%')
  expect(content.value(spec.data[0].values[4])).toBe('No data for this hour')
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
