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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'

import type {
  ModelHistorySeries,
  ModelRanking,
  VendorRanking,
  VendorShareSeries,
} from '../../types'
import { MarketShareSection } from '../market-share-section'
import { ModelsSection } from '../models-section'

type CapturedValue = {
  ts: string
  label: string
  tokens: number
}

type CapturedSpec = {
  data: Array<{ id: string; values: CapturedValue[] }>
  axes: Array<{ orient: string; type?: string; domain?: string[] }>
  tooltip?: { trigger?: string[]; enterable?: boolean }
}

const chart = vi.hoisted(() => vi.fn((_props: { spec: CapturedSpec }) => null))
vi.mock('@visactor/react-vchart', () => ({ VChart: chart }))
vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

const HOUR = 3600
// 01:00 local time keeps the 24 hour labels deterministic and unique.
const WINDOW_START = Math.floor(
  new Date(2026, 8, 28, 1, 0, 0, 0).getTime() / 1000
)

/** The hourly axis of the /rankings `today` period: every distinct bucket
 * label of the range, of which only two carry traffic. */
const TIMELINE = Array.from({ length: 24 }, (_, index) => {
  const date = new Date((WINDOW_START + index * HOUR) * 1000)
  return {
    ts: date.toISOString(),
    label: `${String(date.getHours()).padStart(2, '0')}:00`,
  }
})

const ALL_LABELS = TIMELINE.map((bucket) => bucket.label)
const IDLE_LABEL = '13:00'

const MODEL_POINTS = [TIMELINE[2], TIMELINE[19]].map((bucket) => ({
  ...bucket,
  model: 'gpt-4o',
  vendor: 'OpenAI',
  tokens: 1200,
}))

const VENDOR_POINTS = [TIMELINE[2], TIMELINE[19]].map((bucket) => ({
  ...bucket,
  vendor: 'OpenAI',
  share: 1,
  tokens: 1200,
}))

function modelHistory(): ModelHistorySeries {
  return {
    points: MODEL_POINTS,
    models: [{ name: 'gpt-4o', vendor: 'OpenAI', total: 2400 }],
    buckets: TIMELINE.length,
    timeline: TIMELINE,
  }
}

function vendorHistory(): VendorShareSeries {
  return {
    points: VENDOR_POINTS,
    vendors: [{ name: 'OpenAI', total: 2400, share: 1 }],
    buckets: TIMELINE.length,
    timeline: TIMELINE,
  }
}

function modelRow(): ModelRanking {
  return {
    rank: 1,
    model_name: 'gpt-4o',
    vendor: 'OpenAI',
    category: 'all',
    total_tokens: 2400,
    share: 1,
    growth_pct: 0,
  }
}

function vendorRow(): VendorRanking {
  return {
    rank: 1,
    vendor: 'OpenAI',
    total_tokens: 2400,
    share: 1,
    growth_pct: 0,
    models_count: 1,
    top_model: 'gpt-4o',
  }
}

/** Both sections render entity links, so the router context has to be there. */
function renderSection(node: ReactNode) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => node }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  return render(<RouterProvider router={router} />)
}

async function capturedSpec(): Promise<CapturedSpec> {
  await waitFor(() => expect(chart).toHaveBeenCalled())
  const lastCall = chart.mock.calls.at(-1)
  if (!lastCall) throw new Error('the chart has not been rendered yet')
  return lastCall[0].spec
}

it('keeps every idle bucket of the period on the model chart axis', async () => {
  chart.mockClear()
  renderSection(
    <ModelsSection
      history={modelHistory()}
      rows={[modelRow()]}
      period='today'
    />
  )

  const spec = await capturedSpec()
  expect(spec.axes[0]).toMatchObject({ orient: 'bottom', type: 'band' })
  expect(spec.axes[0].domain).toEqual(ALL_LABELS)
  expect(spec.axes[0].domain).toContain(IDLE_LABEL)
  // The points stay sparse, so an idle bucket renders as an empty column
  // instead of a zero-height stack with a 0-token tooltip.
  expect(spec.data[0].values.map((value) => value.label)).toEqual([
    '03:00',
    '20:00',
  ])
})

it('opens the model chart tooltip on a tap, not just a hover', async () => {
  chart.mockClear()
  renderSection(
    <ModelsSection
      history={modelHistory()}
      rows={[modelRow()]}
      period='today'
    />
  )

  // The tooltip's own hover trigger is pointermove in `desktop-browser` mode, so
  // a stationary tap on a phone would otherwise never show a bucket's value.
  expect((await capturedSpec()).tooltip?.trigger).toEqual(['hover', 'click'])
})

it('opens the market share tooltip on a tap, not just a hover', async () => {
  chart.mockClear()
  renderSection(
    <MarketShareSection
      history={vendorHistory()}
      rows={[vendorRow()]}
      period='today'
    />
  )

  expect((await capturedSpec()).tooltip?.trigger).toEqual(['hover', 'click'])
})

it('keeps every idle bucket of the period on the market share axis', async () => {
  chart.mockClear()
  renderSection(
    <MarketShareSection
      history={vendorHistory()}
      rows={[vendorRow()]}
      period='today'
    />
  )

  const spec = await capturedSpec()
  expect(spec.axes[0]).toMatchObject({ orient: 'bottom', type: 'band' })
  expect(spec.axes[0].domain).toEqual(ALL_LABELS)
  expect(spec.axes[0].domain).toContain(IDLE_LABEL)
  expect(spec.data[0].values.map((value) => value.label)).toEqual([
    '03:00',
    '20:00',
  ])
})
