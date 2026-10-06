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
import type { Table as TanstackTable } from '@tanstack/react-table'

import { isFillerColumn } from './content-sized-columns'

export function DataTableColgroup<TData>({
  table,
  equalColumns,
}: {
  table: TanstackTable<TData>
  /** No column holds a width yet, so every column shares the table evenly. */
  equalColumns?: boolean
}) {
  const columns = table.getVisibleLeafColumns()
  const sizedColumns = columns.filter((column) => !isFillerColumn(column.id))
  const totalSize = sizedColumns.reduce((sum, col) => sum + col.getSize(), 0)

  return (
    <colgroup>
      {columns.map((column) => {
        const width = equalColumns
          ? getEqualColumnWidth(column.id)
          : getColumnWidth(table, column.id, column.getSize(), totalSize)

        return <col key={column.id} style={{ width }} />
      })}
    </colgroup>
  )
}

/**
 * An even frame lets the browser divide the table, which it does over every
 * column that declares no width — including the spacer, whose share would then
 * come out of the visible columns and, on a loading frame, be filled by the
 * placeholder bar of a column that holds nothing. Taking the spacer out of the
 * division leaves the whole table to the columns that are actually rendered.
 */
function getEqualColumnWidth(columnId: string) {
  return isFillerColumn(columnId) ? '0px' : undefined
}

function getColumnWidth<TData>(
  table: TanstackTable<TData>,
  columnId: string,
  columnSize: number,
  totalSize: number
) {
  // No width at all: the browser hands this column everything the sized columns
  // leave over, which is what keeps the table flush with its container.
  if (isFillerColumn(columnId)) {
    return undefined
  }

  if (table.options.enableColumnResizing === true) {
    return `${columnSize}px`
  }

  if (totalSize <= 0) {
    return undefined
  }

  return `${(columnSize / totalSize) * 100}%`
}
