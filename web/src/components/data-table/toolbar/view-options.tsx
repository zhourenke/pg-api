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
import type { Table } from '@tanstack/react-table'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

import { FILLER_COLUMN_ID } from '../core/content-sized-columns'

type DataTableViewOptionsProps<TData> = {
  table: Table<TData>
}

/**
 * Column visibility control for a table.
 *
 * Only the column toggles live here. Fitting every column to its content is the
 * `DataTableFitColumnsButton` the toolbar renders next to this one; offering it
 * here as well would be the same action under a second name in the same row.
 *
 * Hidden when the table has no hideable column, so the menu can never open on an
 * empty list.
 */
export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  const { t } = useTranslation()

  // Track table column visibility so DataTableViewOptions re-renders
  // whenever visibility changes.
  const columnVisibility = table.getState().columnVisibility
  void columnVisibility

  const hideableColumns = React.useMemo(
    () =>
      table
        .getAllColumns()
        .filter(
          (column) => column.id !== FILLER_COLUMN_ID && column.getCanHide()
        ),
    [table]
  )

  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0)

  if (hideableColumns.length === 0) {
    return null
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger
        render={
          <Button
            variant='outline'
            className='shrink-0'
            aria-label={t('View')}
          />
        }
      >
        {t('View')}
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' className='w-auto min-w-[150px]'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t('Toggle columns')}</DropdownMenuLabel>
          {hideableColumns.map((column) => {
            return (
              <DropdownMenuCheckboxItem
                key={column.id}
                className='capitalize'
                checked={column.getIsVisible()}
                onCheckedChange={(value) => {
                  column.toggleVisibility(!!value)
                  forceUpdate()
                }}
              >
                {typeof column.columnDef.header === 'string'
                  ? column.columnDef.header
                  : (column.columnDef.meta?.label ?? column.id)}
              </DropdownMenuCheckboxItem>
            )
          })}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
