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
import { BadgeListCell } from '@/components/data-table/core/badge-list-cell'
import { StatusBadge } from '@/components/status-badge'
import { Badge } from '@/components/ui/badge'

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
  {
    id: 'badge',
    header: 'Badge',
    size: 180,
    cell: () => (
      <Badge variant='outline'>
        <span>Multi-Group Ratio 1.5x</span>
      </Badge>
    ),
  },
  {
    id: 'status',
    header: 'Status',
    size: 180,
    cell: () => (
      <StatusBadge variant='success' label='Listing hidden from model square' />
    ),
  },
  {
    id: 'tags',
    header: 'Tags',
    size: 180,
    cell: () => (
      <BadgeListCell
        items={[
          <StatusBadge key='1' label='fast-preview' />,
          <StatusBadge key='2' label='multimodal' />,
        ]}
      />
    ),
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

  it('renders badges with max-w-full, min-w-0, shrink and truncatable spans so the box shrinks before clipping', () => {
    render(<Harness />)

    const badgeCell = bodyCells()[2]
    const badge = badgeCell.querySelector('[data-slot="badge"]') as HTMLElement
    expect(badge).not.toBeNull()
    expect(badge.className).toContain('max-w-full')
    expect(badge.className).toContain('min-w-0')
    expect(badge.className).toContain('shrink')

    const badgeText = badge.querySelector('span') as HTMLElement
    expect(badgeText).not.toBeNull()
  })

  it('renders status badges with shrinkable containers and truncated text content', () => {
    render(<Harness />)

    const statusCell = bodyCells()[3]
    const statusBadge = statusCell.querySelector(
      '[data-slot="status-badge"]'
    ) as HTMLElement
    expect(statusBadge).not.toBeNull()
    expect(statusBadge.className).toContain('max-w-full')
    expect(statusBadge.className).toContain('min-w-0')
    expect(statusBadge.className).toContain('shrink')

    const statusText = statusBadge.querySelector('span') as HTMLElement
    expect(statusText).not.toBeNull()
    expect(statusText.className).toContain('truncate')
    expect(statusText.className).toContain('min-w-0')
  })

  it('renders badge list cells with max-w-full min-w-0 overflow-hidden wrapper', () => {
    render(<Harness />)

    const tagsCell = bodyCells()[4]
    const badgeListWrapper = tagsCell.querySelector(
      '[data-slot="tooltip-trigger"]'
    ) as HTMLElement
    expect(badgeListWrapper).not.toBeNull()
    expect(badgeListWrapper.className).toContain('max-w-full')
    expect(badgeListWrapper.className).toContain('min-w-0')
    expect(badgeListWrapper.className).toContain('overflow-hidden')
  })
})
