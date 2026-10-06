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
import type { CellContext, Row } from '@tanstack/react-table'
import { render, renderHook, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Channel } from '../../types'
import { ChannelRowActionsLayoutContext } from '../channel-row-actions-context'
import { BalanceCell, useChannelsColumns } from '../channels-columns'

vi.mock('../channels-provider', () => ({
  useChannels: () => ({ sensitiveVisible: true }),
}))

/**
 * The aggregate row's identity cell is shared by the table and the card, and the
 * two give it very different widths: the card spends both of its right-hand
 * tracks on spinners, so the cell has to be able to give way. jsdom lays nothing
 * out, so the contract that keeps the channel count readable is pinned as the
 * class token that lets the row wrap.
 */
function renderAggregateNameCell() {
  const tagRow = {
    id: 'tag:Command',
    name: 'Command',
    tag: 'Command',
    children: [{ id: 1 }, { id: 2 }],
  } as unknown as Channel
  const row = {
    original: tagRow,
    getValue: (key: string) => (key === 'name' ? 'Command' : undefined),
    getToggleExpandedHandler: () => () => {},
    getIsExpanded: () => false,
  } as unknown as Row<Channel>

  const { result } = renderHook(() => useChannelsColumns())
  const nameColumn = result.current.find(
    (column) => 'accessorKey' in column && column.accessorKey === 'name'
  )
  if (!nameColumn?.cell) {
    throw new Error('the name column has no cell renderer')
  }
  const renderCell = nameColumn.cell as (
    context: CellContext<Channel, unknown>
  ) => React.ReactNode

  const context = { row } as unknown as CellContext<Channel, unknown>
  return render(<>{renderCell(context)}</>)
}

/**
 * The tag row reports null for priority or weight when its channels disagree,
 * and the cell turns that into a dash plus the values actually in the group, so
 * the two cells need the same shape as the name cell above.
 */
function renderAggregatePriorityCell(
  priority: number | null,
  children: Array<{ id: number; priority: number }>
) {
  const tagRow = {
    id: 'tag:Command',
    name: 'Command',
    tag: 'Command',
    priority,
    weight: 99,
    children,
  } as unknown as Channel
  const row = { original: tagRow } as unknown as Row<Channel>
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const wrapper = ({ children: node }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{node}</QueryClientProvider>
  )

  const { result } = renderHook(() => useChannelsColumns(), { wrapper })
  const priorityColumn = result.current.find(
    (column) => 'accessorKey' in column && column.accessorKey === 'priority'
  )
  if (!priorityColumn?.cell) {
    throw new Error('the priority column has no cell renderer')
  }
  const renderCell = priorityColumn.cell as (
    context: CellContext<Channel, unknown>
  ) => React.ReactNode

  const context = { row } as unknown as CellContext<Channel, unknown>
  return render(
    <QueryClientProvider client={queryClient}>
      {renderCell(context)}
    </QueryClientProvider>
  )
}

/**
 * The balance cell serves two layouts from the same computation: the table shows
 * both figures in one cell, and the card gives each figure a cell of its own with
 * a label, so the cell has to be able to render one half at a time.
 */
function renderBalanceCell(
  channel: Channel,
  options: { part?: 'used' | 'remaining'; layout?: 'table' | 'card' } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelRowActionsLayoutContext.Provider
        value={options.layout ?? 'table'}
      >
        <BalanceCell channel={channel} part={options.part} />
      </ChannelRowActionsLayoutContext.Provider>
    </QueryClientProvider>
  )
}

const plainChannel = {
  id: 1,
  name: 'balance-fixture',
  used_quota: 12.3456,
  balance: 5.25,
} as unknown as Channel

const tagChannel = {
  id: 'tag:Command',
  name: 'Command',
  tag: 'Command',
  used_quota: 12.3456,
  children: [{ id: 1 }, { id: 2 }],
} as unknown as Channel

describe('channel aggregate row', () => {
  it('lets the tag name row wrap so the channel count is not truncated', () => {
    renderAggregateNameCell()

    const label = screen.getByText((content) => content.startsWith('Tag：'))
    const row = label.parentElement as HTMLElement

    expect(row.textContent).toContain('channels')
    expect(row.className.split(/\s+/)).toContain('flex-wrap')
  })

  it('shows a dash instead of a zero when the tag channels disagree on priority', () => {
    renderAggregatePriorityCell(null, [
      { id: 1, priority: 0 },
      { id: 2, priority: 5 },
    ])

    // "channels disagree" used to render as 0, which is also what a group where
    // every channel really is 0 looks like; the dash keeps the two apart and the
    // explanation names the values that are actually in the group.
    const value = screen.getByLabelText(/with values 0、5/)
    expect(value).toHaveTextContent('—')
    expect(screen.getByLabelText('Decrement')).toBeDisabled()
  })

  it('still shows the shared priority when the tag channels agree', () => {
    renderAggregatePriorityCell(5, [
      { id: 1, priority: 5 },
      { id: 2, priority: 5 },
    ])

    expect(screen.getByTitle('5')).toHaveTextContent('5')
    expect(screen.getByLabelText('Increment')).toBeEnabled()
  })
})

describe('channel balance cell', () => {
  it('renders one figure when the card asks for half of the balance', () => {
    const text = ({ container }: { container: HTMLElement }) =>
      (container.textContent ?? '').trim()

    const both = text(renderBalanceCell(plainChannel))
    const used = text(renderBalanceCell(plainChannel, { part: 'used' }))
    const remaining = text(
      renderBalanceCell(plainChannel, { part: 'remaining' })
    )

    // The card puts the used figure in one cell and the remaining figure in
    // another, so each half has to stand on its own, and the two together have to
    // be exactly what the shared cell renders — no figure dropped, none doubled.
    expect(used.length).toBeGreaterThan(0)
    expect(remaining.length).toBeGreaterThan(0)
    expect(used).not.toBe(remaining)
    expect(both).toBe(`${used}${remaining}`)
  })

  it('shows only the used figure for a tag row, unnamed where the card labels it', () => {
    expect(renderBalanceCell(tagChannel).container.textContent).toContain(
      'Used:'
    )
    expect(
      renderBalanceCell(tagChannel, { part: 'remaining' }).container.textContent
    ).toBe('')

    // The card's own "Used" label names the figure, so the badge does not repeat
    // the word there; the table's column header names both figures, which is why
    // the badge says which one it is.
    const card = renderBalanceCell(tagChannel, { layout: 'card' })
    expect(card.container.textContent).not.toContain('Used:')
    expect((card.container.textContent ?? '').trim().length).toBeGreaterThan(0)
  })
})
