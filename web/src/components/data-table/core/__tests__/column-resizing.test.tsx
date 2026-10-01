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
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataTableView, useDataTable } from '@/components/data-table'

type Row = { id: number; name: string }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', size: 220, minSize: 120 },
  {
    id: 'actions',
    header: 'Actions',
    size: 120,
    cell: () => <button type='button'>Edit</button>,
  },
]

function Harness() {
  const { table } = useDataTable({
    data: [{ id: 1, name: 'alpha' }],
    columns,
  })

  return <DataTableView table={table} applyHeaderSize />
}

function getColumnWidths() {
  return [...screen.getByRole('table').querySelectorAll('col')].map(
    (col) => (col as HTMLElement).style.width
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})

describe('column resizing', () => {
  it('sizes columns from the declared widths and keeps the table scrollable', () => {
    render(<Harness />)

    // `actions` is content-sized (`1%`), every other column keeps its designed
    // pixel width so the starting layout matches the declared sizes.
    expect(getColumnWidths()).toEqual(['220px', '1%'])
    const table = screen.getByRole('table')
    expect(table.style.tableLayout).toBe('auto')
    expect(table.style.minWidth).toBe('max(100%, 220px)')
  })

  it('renders a keyboard-resizable separator for resizable columns only', async () => {
    render(<Harness />)

    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(1)
    expect(separators[0]).toHaveAttribute('aria-label', 'Resize column')

    const user = userEvent.setup()
    separators[0].focus()
    await user.keyboard('{ArrowRight}')

    expect(getColumnWidths()[0]).toBe('230px')
  })

  it('never persists the adjusted width', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)

    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.setup().keyboard('{ArrowRight}')

    expect(getColumnWidths()[0]).toBe('230px')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('keeps the column header’s accessible name when a resize separator is present', () => {
    render(<Harness />)

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    expect(
      screen.queryByRole('columnheader', { name: /Resize column/ })
    ).not.toBeInTheDocument()
  })

  it('does not offer resizing on narrow viewports', () => {
    const originalMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...originalMatchMedia(query),
      matches: query === '(max-width: 640px)',
    }))

    render(<Harness />)

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })
})
