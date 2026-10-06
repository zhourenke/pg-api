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
import type { Row } from '@tanstack/react-table'
import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { Channel } from '../../types'
import { ChannelCard } from '../channel-card'
import { NumericSpinnerInput } from '../numeric-spinner-input'

vi.mock('../channels-provider', () => ({
  useChannels: () => ({ sensitiveVisible: true }),
}))

/**
 * jsdom lays nothing out and does not evaluate container queries, so what these
 * cases can protect is the card's markup contracts: which cell of the grid each
 * figure lands in, and that the two spinner columns take their width from the
 * grid's tracks rather than from the buttons behind their own container query —
 * a box sized by those buttons would measure a few pixels, the query would stay
 * false, and the buttons would never appear.
 */
function fixtureCard() {
  const spinnerCell = () => (
    <NumericSpinnerInput value={99} onChange={() => {}} />
  )
  const cells = ['priority', 'weight'].map((id) => ({
    column: { id, columnDef: { cell: spinnerCell } },
    getContext: () => ({}),
  }))
  const row = {
    original: { id: 7, name: 'card-fixture', status: 1, group: '' } as Channel,
    getAllCells: () => cells,
  } as unknown as Row<Channel>

  // The card renders the balance cell itself now, because the used and remaining
  // figures go in two cells of their own, and that cell reads from react-query.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ChannelCard row={row} isSelected={false} />
    </QueryClientProvider>
  )
}

describe('channel card', () => {
  it('gives the identity a row of its own and the six figures three equal columns', () => {
    const { container } = fixtureCard()

    const grid = container.querySelector('dl')?.parentElement
    const [identity, used, priority, weight] = [...(grid?.children ?? [])]

    // Equal thirds, with the identity keeping the whole first row. It used to
    // share a row with the two spinners and keep only what their fixed tracks
    // did not use, which in a narrow card cut the channel name to a few
    // characters and trimmed the aggregate row's chevron and count badge.
    expect(grid?.className).toContain('grid-cols-3')
    expect(identity?.className).toContain('col-span-3')
    // The used figure opens the second row, so nothing is left hanging at the
    // right edge, and the remaining figure opens the third.
    expect(used?.textContent).toContain('Used')
    expect(priority?.className).toContain('col-start-2')
    expect(weight?.className).toContain('col-start-3')
    expect(grid?.querySelector('dl div dt')?.textContent).toBe('Remaining')
  })

  it('lets the two spinner columns take their width from the grid tracks', () => {
    const { container } = fixtureCard()

    const grid = container.querySelector('dl')?.parentElement
    const spinnerColumns = [...(grid?.children ?? [])].filter((child) =>
      child.querySelector('[class*="@container/spinner"]')
    )

    expect(spinnerColumns).toHaveLength(2)
    for (const column of spinnerColumns) {
      expect(
        column.querySelector('[class*="@container/spinner"]')?.className
      ).toContain('w-full')
    }
  })

  it('aligns the last tested value with its label', () => {
    const { container } = fixtureCard()

    const label = [...container.querySelectorAll('dt')].find(
      (node) => node.textContent === 'Last Tested'
    )
    // The cell renders a badge inside a tooltip trigger, and the trigger's own
    // `data-slot` replaces the badge's, so a selector written against
    // `status-badge` would never cancel the negative margin the badge carries
    // for the table. The card cancels it on the child it actually gets.
    expect(label?.nextElementSibling?.className).toContain('[&>span]:ml-0')
  })
})
