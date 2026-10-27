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

function renderBreakdown() {
  return render(
    <FlowBreakdown
      rows={ROWS}
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
})
