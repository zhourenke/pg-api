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
import { describe, expect, it } from 'vitest'

import { DataTableView, useDataTable } from '@/components/data-table'

type Row = { id: number; name: string }

/**
 * A cell whose content is a component rather than a plain string — the case
 * that used to skip the clip, because the old rule only clipped cells that
 * happened to render a primitive.
 */
function NameWithIcon() {
  return (
    <span className='flex min-w-0 items-center gap-1'>
      <span className='min-w-0 truncate'>alpha-model-name</span>
      <span className='shrink-0'>icon</span>
    </span>
  )
}

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', size: 180 },
  {
    id: 'component',
    header: 'Component',
    size: 180,
    cell: () => <NameWithIcon />,
  },
]

function Harness() {
  const { table } = useDataTable({
    data: [{ id: 1, name: 'alpha' }],
    columns,
  })

  return <DataTableView table={table} />
}

function bodyCells() {
  const row = screen.getByRole('table').querySelector('tbody tr')
  return [...(row?.children ?? [])] as HTMLElement[]
}

describe('table cell overflow', () => {
  it('clips a cell whose content is a plain string', () => {
    render(<Harness />)

    expect(bodyCells()[0].className).toContain('overflow-hidden')
  })

  it('clips a cell whose content is a component', () => {
    render(<Harness />)

    // Without this the component could paint over the column on its right when
    // the column is dragged narrow, which is how text used to cover a
    // neighbouring column's copy button.
    expect(bodyCells()[1].className).toContain('overflow-hidden')
  })

  it('clips the header cell so a squeezed header cannot paint over its neighbour', () => {
    render(<Harness />)

    const headerCells = [
      ...screen.getByRole('table').querySelectorAll('thead th'),
    ] as HTMLElement[]

    expect(headerCells.length).toBeGreaterThan(0)
    for (const cell of headerCells) {
      expect(cell.className).toContain('overflow-hidden')
    }
  })
})
