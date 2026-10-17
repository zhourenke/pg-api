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
import { act, render, renderHook, screen } from '@testing-library/react'
import i18n from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'

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
function renderAggregateNameCell(tag = 'Command') {
  const tagRow = {
    id: `tag:${tag}`,
    name: tag,
    tag,
    children: [{ id: 1 }, { id: 2 }],
  } as unknown as Channel
  const row = {
    original: tagRow,
    getValue: (key: string) => (key === 'name' ? tag : undefined),
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

function renderAggregateStatusCell(
  childrenStatuses: number[] = [1, 1],
  rowStatus: number = 1
) {
  const tagRow = {
    id: 'tag:Command',
    name: 'Command',
    tag: 'Command',
    status: rowStatus,
    used_quota: 12.3456,
    children: childrenStatuses.map((s, index) => ({
      id: index + 1,
      status: s,
    })),
  } as unknown as Channel
  const row = {
    original: tagRow,
    getValue: (key: string) => (key === 'status' ? rowStatus : undefined),
  } as unknown as Row<Channel>

  const { result } = renderHook(() => useChannelsColumns())
  const statusColumn = result.current.find(
    (column) => 'accessorKey' in column && column.accessorKey === 'status'
  )
  if (!statusColumn?.cell) {
    throw new Error('the status column has no cell renderer')
  }
  const renderCell = statusColumn.cell as (
    context: CellContext<Channel, unknown>
  ) => React.ReactNode

  const context = { row } as unknown as CellContext<Channel, unknown>
  return render(<>{renderCell(context)}</>)
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

    const label = screen.getByText((content) => content.startsWith('Tag:'))
    const row = label.parentElement as HTMLElement

    // The count badge interpolates `{{count}}`, so the identity bundle still
    // renders a real number here.
    expect(row.textContent).toContain('2 channels')
    expect(row.className.split(/\s+/)).toContain('flex-wrap')
  })

  it('renders the aggregate row in the interface language, not raw English', async () => {
    // 这一行过去有三个写死的英文串（状态、计数、标签前缀），在只有中文的界面里
    // 读起来是「标签聚合 / Active (1) / Tag：Command / 1 channels」混着。三个都
    // 改走 `t()`：前缀复用已有词条，两条计数文案各自带 `{{count}}` 占位符。
    // 空词条会让 `t('Active ({{count}})')` 插值成 "Active (2)"，与写死的样子无法
    // 区分，所以这一条加载真实的中文词条来钉住文案。
    await act(async () => {
      i18n.addResourceBundle(
        'zhCN',
        'translation',
        zhCN.translation,
        true,
        true
      )
      await i18n.changeLanguage('zhCN')
    })

    const name = renderAggregateNameCell()
    expect(name.container).toHaveTextContent('标签：Command')
    expect(name.container).toHaveTextContent('2 个渠道')
    expect(name.container.textContent).not.toContain('channels')

    const active = renderAggregateStatusCell([1, 1], 1)
    expect(active.container).toHaveTextContent('生效')
    expect(active.container.textContent).not.toContain('（')

    const partial = renderAggregateStatusCell([1, 2], 1)
    expect(partial.container).toHaveTextContent('部分生效（1/2）')

    const inactive = renderAggregateStatusCell([2, 2], 2)
    expect(inactive.container).toHaveTextContent('未生效')
    expect(inactive.container.textContent).not.toContain('（')
  })

  it('names the group of channels that carry no tag', async () => {
    // 没有标签的渠道过去在标签模式里整条不出现；现在后端把这一组排在最后一组，
    // 它没有标签名可用，界面得自己给个说法，否则这一行只剩「标签：」。
    await act(async () => {
      i18n.addResourceBundle(
        'zhCN',
        'translation',
        zhCN.translation,
        true,
        true
      )
      await i18n.changeLanguage('zhCN')
    })

    const untagged = renderAggregateNameCell('')
    expect(untagged.container).toHaveTextContent('未打标签')
    expect(untagged.container).not.toHaveTextContent('标签：')
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

  it('pushes the two figures to the two ends of the cell in the table', () => {
    // jsdom lays nothing out, so what can be pinned here is the contract that
    // makes the browser do it: a row that spreads its two figures apart and hangs
    // each one out by its own badge padding, so the *text* — not the badge box —
    // meets the cell edge and the decimals line up down the column.
    const row = (container: HTMLElement) =>
      container.querySelector('div[class*="flex"]') as HTMLElement

    const table = row(renderBalanceCell(plainChannel).container)
    expect(table.className.split(/\s+/)).toContain('justify-between')
    expect(table.className).toContain('[&>*:first-child]:-ml-1.5')
    expect(table.className).toContain('[&>*:last-child]:-mr-1.5')

    // The card consumes the same cell one half at a time under a label of its
    // own, where spreading the pair apart would break the centring; if a card
    // ever renders both halves in one row, they must keep sitting next to the
    // left edge instead.
    const card = row(
      renderBalanceCell(plainChannel, { layout: 'card' }).container
    )
    expect(card.className.split(/\s+/)).not.toContain('justify-between')
    expect(card.className.split(/\s+/)).toContain('-ml-1.5')
  })
})
