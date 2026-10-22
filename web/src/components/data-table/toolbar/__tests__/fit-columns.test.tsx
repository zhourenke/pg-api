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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import { fireEvent, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { DataTableFitColumnsButton } from '../fit-columns-button'
import { DataTableToolbar } from '../toolbar'

const rows = [{ name: 'Item 1' }]

describe('DataTableFitColumnsButton and toolbar integration', () => {
  it('renders fit columns button with accessible title and invokes fitColumnWidths on click', () => {
    const fitColumnWidths = vi.fn()
    function Fixture() {
      const table = useReactTable({
        data: rows,
        columns: [{ accessorKey: 'name', header: 'Name' }],
        getCoreRowModel: getCoreRowModel(),
        meta: {
          fitColumnWidths,
        },
      })

      return <DataTableFitColumnsButton table={table} />
    }

    render(<Fixture />)
    const button = screen.getByRole('button', { name: /Fit column widths/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('title', 'Fit column widths')

    fireEvent.click(button)
    expect(fitColumnWidths).toHaveBeenCalledTimes(1)
  })

  it('renders a text-only trigger without a leading icon', () => {
    function Fixture() {
      const table = useReactTable({
        data: rows,
        columns: [{ accessorKey: 'name', header: 'Name' }],
        getCoreRowModel: getCoreRowModel(),
      })

      return <DataTableFitColumnsButton table={table} />
    }

    render(<Fixture />)
    const button = screen.getByRole('button', { name: /Fit column widths/i })
    const label = screen.getByText('Fit columns')

    expect(label.tagName).toBe('SPAN')
    expect(label).toHaveClass('whitespace-nowrap')
    expect(button.querySelector('svg')).toBeNull()
    expect(button).toHaveTextContent('Fit columns')
  })

  it('renders nothing at the width where the table becomes a card list', () => {
    const original = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...original(query),
      matches: query === '(max-width: 640px)',
    }))

    function Fixture() {
      const table = useReactTable({
        data: rows,
        columns: [{ accessorKey: 'name', header: 'Name' }],
        getCoreRowModel: getCoreRowModel(),
      })

      return <DataTableToolbar table={table} />
    }

    render(<Fixture />)

    // Card rows have no column widths to fit, so the trigger must not survive as
    // an icon-only button that acts on a table the user cannot see.
    expect(screen.queryByText('Fit columns')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Fit column widths/i })
    ).not.toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('renders in DataTableToolbar by default and allows hiding via hideFitColumns', () => {
    function Fixture(props: { hideFitColumns?: boolean }) {
      const table = useReactTable({
        data: rows,
        columns: [{ accessorKey: 'name', header: 'Name' }],
        getCoreRowModel: getCoreRowModel(),
      })

      return (
        <DataTableToolbar table={table} hideFitColumns={props.hideFitColumns} />
      )
    }

    const { rerender } = render(<Fixture />)
    expect(
      screen.getByRole('button', { name: /Fit column widths/i })
    ).toBeInTheDocument()

    rerender(<Fixture hideFitColumns />)
    expect(
      screen.queryByRole('button', { name: /Fit column widths/i })
    ).not.toBeInTheDocument()
  })

  it('renders the short Chinese label 适应 with the full text as accessible name', () => {
    i18n.addResourceBundle('zhCN', 'translation', zh.translation, true, true)

    function Fixture() {
      const table = useReactTable({
        data: rows,
        columns: [{ accessorKey: 'name', header: 'Name' }],
        getCoreRowModel: getCoreRowModel(),
      })

      return <DataTableFitColumnsButton table={table} />
    }

    render(<Fixture />)
    const button = screen.getByRole('button', { name: '自适应列宽' })
    expect(button).toBeInTheDocument()
    expect(button).toHaveAttribute('title', '自适应列宽')
    expect(screen.getByText('适应')).toBeInTheDocument()
    // The visible words stay inside the accessible name, so speech input can
    // still match what the user reads.
    expect(button.textContent).toBe('适应')
    expect(button.getAttribute('aria-label')).toContain(button.textContent)
  })
})
