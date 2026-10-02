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
import { render, screen } from '@testing-library/react'
import { Button } from '@/components/ui/button'
import { describe, expect, it } from 'vitest'

import { DataTableToolbar } from '../toolbar'

const rows = [{ name: 'Channel' }]

function Fixture(props: { singleRow?: boolean }) {
  const table = useReactTable({
    data: rows,
    columns: [{ accessorKey: 'name' }],
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <DataTableToolbar
      table={table}
      searchPlaceholder='Search channels'
      singleRow={props.singleRow}
      preActions={<Button>Add model</Button>}
    />
  )
}

describe('single row toolbar', () => {
  it('wraps the actions onto a second line by default', () => {
    const { container } = render(<Fixture />)

    expect(container.firstElementChild).toHaveClass('flex-wrap')
    expect(screen.getByPlaceholderText('Search channels')).toHaveClass(
      'sm:w-[200px]'
    )
  })

  it('keeps the actions on the search row and lets the search shrink', () => {
    const { container } = render(<Fixture singleRow />)

    const row = container.firstElementChild
    expect(row).not.toHaveClass('flex-wrap')
    expect(row).toHaveClass('items-center')

    const search = screen.getByPlaceholderText('Search channels')
    expect(search).toHaveClass('min-w-0')
    expect(search).toHaveClass('flex-1')
    expect(search).not.toHaveClass('sm:w-[200px]')

    // 动作簇自身不可收缩，被挤压的是搜索框。
    expect(search.nextElementSibling).toHaveClass('shrink-0')
    expect(
      screen.getByRole('button', { name: 'Add model' })
    ).toBeVisible()
  })
})
