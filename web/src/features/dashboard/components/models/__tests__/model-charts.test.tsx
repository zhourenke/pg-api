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
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '@/context/theme-provider'
import type { QuotaDataItem } from '@/features/dashboard/types'

import { ModelCharts } from '../model-charts'

const chart = vi.hoisted(() =>
  vi.fn((_props: { spec: Record<string, unknown> }) => null)
)

vi.mock('@visactor/react-vchart', () => ({ VChart: chart }))
vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

const SAMPLE_DATA: QuotaDataItem[] = [
  {
    model_name: 'gpt-4o',
    quota: 500000,
    count: 100,
    token_used: 100000,
    created_at: 1000,
  },
  {
    model_name: 'deepseek-v3',
    quota: 200000,
    count: 200,
    token_used: 80000,
    created_at: 1000,
  },
]

/** The spec handed to the chart by the most recent render. */
async function latestSpec(): Promise<Record<string, unknown>> {
  await waitFor(() => expect(chart).toHaveBeenCalled())
  return chart.mock.calls.at(-1)?.[0].spec ?? {}
}

function renderCharts() {
  return render(
    <ThemeProvider>
      <ModelCharts data={SAMPLE_DATA} />
    </ThemeProvider>
  )
}

describe('ModelCharts trend style switch', () => {
  afterEach(() => {
    cleanup()
    chart.mockClear()
  })

  it('puts the area/bar switch before the metric selector', () => {
    renderCharts()

    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Area Chart',
      'Bar Chart',
      'By quota',
      'By requests',
      'By tokens',
    ])
  })

  it('draws bars for the request and token metrics once the bar switch is chosen', async () => {
    const user = userEvent.setup()
    renderCharts()

    expect((await latestSpec()).type).toBe('area')

    await user.click(screen.getByRole('tab', { name: 'By requests' }))
    let spec = await latestSpec()
    expect(spec.type).toBe('area')
    expect(spec.yField).toBe('Count')

    await user.click(screen.getByRole('tab', { name: 'Bar Chart' }))
    spec = await latestSpec()
    expect(spec.type).toBe('bar')
    expect(spec.yField).toBe('Count')

    await user.click(screen.getByRole('tab', { name: 'By tokens' }))
    spec = await latestSpec()
    expect(spec.type).toBe('bar')
    expect(spec.yField).toBe('Tokens')
  })
})
