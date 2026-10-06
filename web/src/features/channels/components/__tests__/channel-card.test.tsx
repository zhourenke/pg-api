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
 * cases can protect is the markup contract that lets the card's inline spinners
 * settle at all — the columns that hold them must be given a definite width,
 * because the query container inside the spinner cannot be sized by the very
 * buttons that query gates — plus the row arrangement, which only the placement
 * classes can express without a layout engine.
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

  return render(<ChannelCard row={row} isSelected={false} />)
}

describe('channel card', () => {
  it('gives the spinner columns a definite width for their container query', () => {
    const { container } = fixtureCard()

    const grid = container.querySelector('dl')?.parentElement
    expect(grid?.className).toContain('grid-cols-[minmax(0,1fr)_5.5rem_5.5rem]')

    // The spinners really do render inside those tracks.
    const columns = [...(grid?.querySelectorAll('div.flex-col') ?? [])]
    const withSpinner = columns.filter((column) =>
      column.querySelector('[class*="@container/spinner"]')
    )
    expect(withSpinner).toHaveLength(2)
  })

  it('gives the identity a row of its own and the spinners the row below', () => {
    const { container } = fixtureCard()

    const grid = container.querySelector('dl')?.parentElement
    const [identity, priority, weight] = [...(grid?.children ?? [])]

    // Sharing a row with the two fixed 5.5rem tracks left the identity only what
    // those tracks did not use, which in a narrow card is a few dozen pixels and
    // cut the channel name off. The identity therefore spans the whole row, and
    // the two spinner columns move to the right two cells of the one below.
    expect(identity?.className).toContain('col-span-3')
    expect(identity?.textContent).toContain('#7')
    expect(priority?.className).toContain('col-start-2')
    expect(weight?.className).toContain('col-start-3')
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
