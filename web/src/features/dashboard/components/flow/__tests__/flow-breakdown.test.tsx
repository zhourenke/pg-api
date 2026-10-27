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
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type {
  FlowNodeKind,
  FlowQuotaDataItem,
} from '@/features/dashboard/types'

import { FlowBreakdown } from '../flow-breakdown'

const ROWS: FlowQuotaDataItem[] = [
  {
    token_id: 1,
    token_name: 'tok-a',
    use_group: 'default',
    model_name: 'gpt-4o',
    quota: 60,
  },
  {
    token_id: 1,
    token_name: 'tok-a',
    use_group: 'default',
    model_name: 'gpt-4o-mini',
    quota: 20,
  },
  {
    token_id: 2,
    token_name: 'tok-b',
    use_group: 'vip',
    model_name: 'gpt-4o',
    quota: 20,
  },
]

const STAGE_LABELS: Record<FlowNodeKind, string> = {
  user: 'User',
  node: 'Node',
  token: 'Token',
  group: 'Group',
  model: 'Model',
  channel: 'Channel',
}

// A free/zero-priced model: it is a real, clickable segment, but contributes
// zero to the quota metric, which is exactly the case that used to collapse the
// whole card into the empty state.
const ROWS_WITH_ZERO_MODEL: FlowQuotaDataItem[] = [
  ...ROWS,
  {
    token_id: 1,
    token_name: 'tok-a',
    use_group: 'default',
    model_name: 'muse-spark',
    quota: 0,
  },
]

function renderBreakdown(rows: FlowQuotaDataItem[] = ROWS) {
  return render(
    <FlowBreakdown
      rows={rows}
      metric='quota'
      role='user'
      stages={['token', 'group', 'model']}
      topLimit={50}
      stageLabels={STAGE_LABELS}
      formatMetricValue={(value) => String(value)}
    />
  )
}

describe('FlowBreakdown', () => {
  afterEach(() => {
    cleanup()
  })

  it('renders one labelled bar per stage with a clickable legend', () => {
    renderBreakdown()

    expect(screen.getByText('Token')).toBeInTheDocument()
    expect(screen.getByText('Group')).toBeInTheDocument()
    expect(screen.getByText('Model')).toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /tok-a/ }).length
    ).toBeGreaterThan(0)
    expect(
      screen.getAllByRole('button', { name: /tok-b/ }).length
    ).toBeGreaterThan(0)
  })

  it('cross-filters the other stages when a segment is tapped', () => {
    renderBreakdown()

    // gpt-4o-mini is only served through tok-a, so selecting it drops tok-b.
    fireEvent.click(screen.getAllByRole('button', { name: /gpt-4o-mini/ })[0])

    // The active filter is shown and the unrelated token drops out.
    expect(screen.getByText('Filtered by')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /tok-b/ })).toHaveLength(0)
  })

  it('clears the filter when the same segment is tapped again', () => {
    renderBreakdown()

    fireEvent.click(screen.getAllByRole('button', { name: /gpt-4o-mini/ })[0])
    expect(screen.getByText('Filtered by')).toBeInTheDocument()
    expect(screen.queryAllByRole('button', { name: /tok-b/ })).toHaveLength(0)

    fireEvent.click(screen.getAllByRole('button', { name: /gpt-4o-mini/ })[0])
    expect(screen.queryByText('Filtered by')).not.toBeInTheDocument()
    expect(
      screen.getAllByRole('button', { name: /tok-b/ }).length
    ).toBeGreaterThan(0)
  })

  it('keeps the card and marks the pick when a zero-usage model is selected', () => {
    renderBreakdown(ROWS_WITH_ZERO_MODEL)

    fireEvent.click(screen.getAllByRole('button', { name: /muse-spark/ })[0])

    // The whole card must not degrade into the empty state.
    expect(screen.queryByText('No flow data available')).not.toBeInTheDocument()
    expect(screen.getByText('Filtered by')).toBeInTheDocument()
    // The picked model stays selected so its (zero) usage is still surfaced.
    expect(
      screen
        .getAllByRole('button', { name: /muse-spark/ })
        .some((el) => el.getAttribute('aria-pressed') === 'true')
    ).toBe(true)
    // A zero-total stage keeps its legend row, so the card does not collapse:
    // the token that served muse-spark is still listed (at ¥0).
    expect(
      screen.getAllByRole('button', { name: /tok-a/ }).length
    ).toBeGreaterThan(0)
  })

  it('rounds the bar ends instead of clipping small edge slices', () => {
    renderBreakdown()

    const bars = screen.getAllByTestId('flow-breakdown-bar')
    expect(bars.length).toBeGreaterThan(0)
    for (const bar of bars) {
      // The bar must not clip its slices with overflow-hidden; the end slices
      // carry their own outer radius, plus a minimum width so a near-zero end
      // slice still has room for the radius instead of going square.
      expect(bar.className).not.toContain('overflow-hidden')
      const firstSlice = bar.firstElementChild as HTMLElement | null
      const lastSlice = bar.lastElementChild as HTMLElement | null
      expect(firstSlice?.className).toContain('first:rounded-l-[5px]')
      expect(lastSlice?.className).toContain('last:rounded-r-[5px]')
      expect(lastSlice?.className).toContain('last:min-w-[10px]')
    }
  })
})
