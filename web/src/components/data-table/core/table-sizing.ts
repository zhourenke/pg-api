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
import type * as React from 'react'

import { isFillerColumn } from './content-sized-columns'

export function getTableSizeStyle<TData>(
  table: TanstackTable<TData>
): React.CSSProperties {
  const width = getSizedColumnsWidth(table)

  if (table.options.enableColumnResizing !== true) {
    return {
      minWidth: `max(100%, ${width}px)`,
      tableLayout: 'auto',
      width: '100%',
    }
  }

  // A fixed layout is what makes a drag literal: the colgroup carries the only
  // width each column has, so resizing one column cannot re-flow the others.
  // The trailing spacer column keeps whichever pixels are left over.
  return {
    minWidth: `max(100%, ${width}px)`,
    tableLayout: 'fixed',
    width: '100%',
  }
}

/** Total width of every column that declares a width, spacer excluded. */
export function getSizedColumnsWidth<TData>(table: TanstackTable<TData>): number {
  return table
    .getVisibleLeafColumns()
    .filter((column) => !isFillerColumn(column.id))
    .reduce((total, column) => total + column.getSize(), 0)
}
