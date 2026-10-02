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
import type { ColumnSizingState, Table as TanstackTable } from '@tanstack/react-table'
import * as React from 'react'

import {
  getContentFitWidth,
  measureColumnContentWidth,
  measureColumnHeaderWidth,
} from '../core/column-measurement'
import { isFillerColumn } from '../core/content-sized-columns'

/**
 * Gives every column the width its own content needs, once, on the first render
 * that actually has rows. Later pages, sorts and filters reuse those widths, so
 * the table does not reflow under the user; a reload starts the measurement
 * over from whatever page is shown then.
 */
export function useMeasuredColumnWidths<TData>(
  table: TanstackTable<TData>,
  tableElementRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean
) {
  const measuredRef = React.useRef(false)

  React.useLayoutEffect(() => {
    const tableElement = tableElementRef.current

    if (measuredRef.current || !enabled || !tableElement) {
      return
    }

    const columns = table
      .getVisibleLeafColumns()
      .filter((column) => !isFillerColumn(column.id))
    if (columns.length === 0) {
      return
    }

    const measured: ColumnSizingState = {}
    let hasMeasurement = false

    for (const column of columns) {
      const contentWidth = measureColumnContentWidth(tableElement, column.id)
      if (contentWidth === undefined) {
        continue
      }

      const headerWidth = measureColumnHeaderWidth(tableElement, column.id)
      const fitWidth = Math.max(
        getContentFitWidth(column, contentWidth),
        headerWidth ?? 0
      )

      if (fitWidth !== column.getSize()) {
        measured[column.id] = fitWidth
        hasMeasurement = true
      }
    }

    measuredRef.current = true

    if (hasMeasurement) {
      table.setColumnSizing((previous) => ({ ...previous, ...measured }))
    }
  })
}
