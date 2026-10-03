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
import type { ColumnDef } from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ResponsiveDataTableView, useDataTable } from '@/components/data-table'

type Row = { id: number; name: string; status: string }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', meta: { mobileTitle: true } },
  { accessorKey: 'status', header: 'Status', meta: { mobileBadge: true } },
]

function Harness() {
  const { table } = useDataTable({
    data: [{ id: 1, name: 'alpha', status: 'ready' }],
    columns,
  })

  return <ResponsiveDataTableView table={table} />
}

function mockViewport(isNarrow: boolean) {
  const original = window.matchMedia
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: isNarrow,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('responsive data table view', () => {
  it('renders the card list instead of a table on narrow viewports', () => {
    mockViewport(true)
    render(<Harness />)

    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('alpha')).toBeTruthy()
    expect(screen.getByText('ready')).toBeTruthy()
  })

  it('keeps the table on tablet and wider viewports', () => {
    mockViewport(false)
    render(<Harness />)

    expect(screen.getByRole('table')).toBeTruthy()
    expect(screen.getByText('alpha')).toBeTruthy()
  })
})
