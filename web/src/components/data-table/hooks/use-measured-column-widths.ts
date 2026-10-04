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
import type {
  ColumnSizingState,
  Table as TanstackTable,
} from '@tanstack/react-table'
import * as React from 'react'

import {
  getContentFitWidth,
  measureColumnContentWidth,
  measureColumnHeaderWidth,
} from '../core/column-measurement'
import { isFillerColumn } from '../core/content-sized-columns'

/**
 * How long the measurement keeps following the cells of a table. It is long
 * enough for a price whose currency arrives with the system configuration and
 * for a web font to swap in, and short enough that a table the user has already
 * started working with never moves under them.
 */
const SETTLE_WINDOW_MS = 3000

/** How often the measurement looks for content that arrived after the first paint. */
const FOLLOW_UP_MS = 250

/**
 * Gives every column the width its own content needs, on the first render that
 * actually has rows. Later pages, sorts and filters reuse those widths, so the
 * table does not reflow under the user; a reload starts the measurement over
 * from whatever page is shown then.
 *
 * Content that only arrives after that first paint would otherwise be measured
 * at its shortest and leave the column too narrow, so the measurement keeps
 * following the cells for the settle window. Dragging a separator, or the
 * window running out, freezes the widths, so the follow-up never fights the
 * user.
 */
export function useMeasuredColumnWidths<TData>(
  table: TanstackTable<TData>,
  tableElementRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean
) {
  const startedRef = React.useRef(false)
  const appliedRef = React.useRef<ColumnSizingState | null>(null)
  const frozenRef = React.useRef(false)

  /**
   * Measures every column and applies the widths. Returns true once the widths
   * must stop following the content, because the user has taken over.
   */
  const measureColumns = React.useCallback(() => {
    const tableElement = tableElementRef.current
    if (frozenRef.current || !tableElement) {
      return frozenRef.current
    }

    const sizing = table.getState().columnSizing
    const applied = appliedRef.current

    if (
      applied &&
      Object.keys(applied).some((id) => sizing[id] !== applied[id])
    ) {
      frozenRef.current = true
      return true
    }

    const measured: ColumnSizingState = {}
    let hasMeasurement = false

    for (const column of table
      .getVisibleLeafColumns()
      .filter((column) => !isFillerColumn(column.id))) {
      const contentWidth = measureColumnContentWidth(tableElement, column.id)
      if (contentWidth === undefined) {
        continue
      }

      const headerWidth = measureColumnHeaderWidth(tableElement, column.id)
      const fitWidth = Math.max(
        getContentFitWidth(column, contentWidth),
        headerWidth ?? 0
      )

      measured[column.id] = fitWidth
      if (fitWidth !== column.getSize()) {
        hasMeasurement = true
      }
    }

    appliedRef.current = measured

    if (hasMeasurement) {
      table.setColumnSizing((previous) => ({ ...previous, ...measured }))
    }

    return false
  }, [table, tableElementRef])

  React.useLayoutEffect(() => {
    if (startedRef.current || !enabled || !tableElementRef.current) {
      return
    }

    const columns = table
      .getVisibleLeafColumns()
      .filter((column) => !isFillerColumn(column.id))
    if (columns.length === 0) {
      return
    }

    startedRef.current = true
    measureColumns()
  }, [enabled, measureColumns, table, tableElementRef])

  React.useEffect(() => {
    if (!enabled || !startedRef.current || frozenRef.current) {
      return
    }

    // Polling, rather than watching the DOM, because the measurement itself
    // re-renders the table: a mutation observer would see its own render and
    // measure again without end. A poll that finds nothing new applies nothing.
    const followUp = window.setInterval(() => {
      if (measureColumns()) {
        window.clearInterval(followUp)
      }
    }, FOLLOW_UP_MS)

    if (document.fonts) {
      void document.fonts.ready
        .catch(() => {})
        .then(() => {
          if (!frozenRef.current) {
            measureColumns()
          }
        })
    }

    const settleTimer = window.setTimeout(
      () => window.clearInterval(followUp),
      SETTLE_WINDOW_MS
    )

    return () => {
      window.clearInterval(followUp)
      window.clearTimeout(settleTimer)
    }
  }, [enabled, measureColumns])
}
