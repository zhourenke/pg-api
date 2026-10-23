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
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as React from 'react'
import { describe, expect, it } from 'vitest'

import { DataTableToolbar } from '../toolbar'
import { DataTableViewOptions } from '../view-options'

const rows = [{ name: 'Channel', displayOnly: 'Custom' }]

function Fixture(props: { hideViewOptions?: boolean }) {
  const table = useReactTable({
    data: rows,
    columns: [{ accessorKey: 'name' }],
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <DataTableToolbar
      table={table}
      searchPlaceholder='Search channels'
      hideViewOptions={props.hideViewOptions}
    />
  )
}

function MultiColumnFixture() {
  const [columnVisibility, setColumnVisibility] = React.useState({})
  const columns: ColumnDef<(typeof rows)[0]>[] = [
    { accessorKey: 'name', header: 'Channel Name' },
    { id: 'displayOnly', header: 'Display Column', cell: () => 'Custom' },
    { id: 'actions', header: 'Actions', enableHiding: false },
  ]
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  })

  return <DataTableViewOptions table={table} />
}

const MemoizedContainer = React.memo(
  function MemoizedContainer(props: {
    table: ReturnType<typeof useReactTable<(typeof rows)[0]>>
  }) {
    return <DataTableViewOptions table={props.table} />
  },
  () => true
)

function FixedColumnsFixture() {
  const columns: ColumnDef<(typeof rows)[0]>[] = [
    { accessorKey: 'name', header: 'Channel Name', enableHiding: false },
    { id: 'actions', header: 'Actions', enableHiding: false },
  ]
  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
  })

  return <DataTableViewOptions table={table} />
}

function MemoizedParentFixture() {
  const [columnVisibility, setColumnVisibility] = React.useState({})
  const columns: ColumnDef<(typeof rows)[0]>[] = [
    { accessorKey: 'name', header: 'Channel Name' },
  ]
  const table = useReactTable({
    data: rows,
    columns,
    state: { columnVisibility },
    onColumnVisibilityChange: setColumnVisibility,
    getCoreRowModel: getCoreRowModel(),
  })

  return <MemoizedContainer table={table} />
}

describe('view options', () => {
  it('offers the column visibility dropdown by default', () => {
    render(<Fixture />)

    expect(screen.getByRole('button', { name: 'View' })).toBeVisible()
  })

  it('hides the dropdown for a table whose columns cannot be hidden', () => {
    render(<Fixture hideViewOptions />)

    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('includes display columns without accessorFn in the view options list', async () => {
    const user = userEvent.setup()
    render(<MultiColumnFixture />)

    await user.click(screen.getByRole('button', { name: 'View' }))

    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Channel Name' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('menuitemcheckbox', { name: 'Display Column' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitemcheckbox', { name: 'Actions' })
    ).toBeNull()
  })

  it('offers no fit-column action, which the toolbar already shows as 适应', async () => {
    const user = userEvent.setup()
    render(<MultiColumnFixture />)

    await user.click(screen.getByRole('button', { name: 'View' }))

    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Channel Name' })
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('menuitem', { name: 'Fit column widths' })
    ).toBeNull()
    expect(screen.queryByRole('menuitem', { name: '自适应列宽' })).toBeNull()
  })

  it('renders no trigger when the table has no hideable column', () => {
    render(<FixedColumnsFixture />)

    expect(screen.queryByRole('button', { name: 'View' })).toBeNull()
  })

  it('toggles column visibility and checkbox state back and forth on repeated clicks inside memoized parent', async () => {
    const user = userEvent.setup()
    render(<MemoizedParentFixture />)

    await user.click(screen.getByRole('button', { name: 'View' }))
    const item = await screen.findByRole('menuitemcheckbox', {
      name: 'Channel Name',
    })

    // Initially checked
    expect(item).toHaveAttribute('aria-checked', 'true')

    // 1st click: should uncheck and hide column
    await user.click(item)
    expect(item).toHaveAttribute('aria-checked', 'false')

    // 2nd click: should re-check and show column
    await user.click(item)
    expect(item).toHaveAttribute('aria-checked', 'true')

    // 3rd click: should uncheck and hide column again
    await user.click(item)
    expect(item).toHaveAttribute('aria-checked', 'false')
  })
})
