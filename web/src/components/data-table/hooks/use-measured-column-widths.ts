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
import { isFillerColumn, isWindowColumn } from '../core/content-sized-columns'

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
 * The columns the measurement is responsible for: everything the table renders,
 * except the spacer that closes it and the columns whose width is declared
 * rather than measured.
 */
function getMeasuredColumns<TData>(table: TanstackTable<TData>) {
  return table
    .getVisibleLeafColumns()
    .filter((column) => !isFillerColumn(column.id) && !isWindowColumn(column))
}

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
 *
 * A column a table starts out hiding is not on screen for that first
 * measurement, so the same effect runs again whenever the set of visible columns
 * changes: the first time the user opens such a column it is fitted to its own
 * content, whenever that happens and even after a drag has frozen the widths of
 * the other columns.
 *
 * Three states, one rule each. The first render that has rows is measured before
 * it is painted, so a declared width never reaches the screen on a table with
 * data. A table with no rows — loading, or empty — is not measured at all and is
 * rendered as an even frame instead (see `getTableSizeStyle`). And once the user
 * has dragged a separator the widths are theirs: a double click on that
 * separator, or the arrow keys on it, asks for the content width again.
 */
export function useMeasuredColumnWidths<TData>(
  table: TanstackTable<TData>,
  tableElementRef: React.RefObject<HTMLTableElement | null>,
  enabled: boolean
) {
  const startedRef = React.useRef(false)
  const appliedRef = React.useRef<ColumnSizingState | null>(null)
  const measuredIdsRef = React.useRef(new Set<string>())
  const frozenRef = React.useRef(false)

  /**
   * Measures columns and applies the widths. Returns true once the widths must
   * stop following the content, because the user has taken over.
   *
   * `unmeasuredOnly` narrows the pass to the columns that have never been given
   * a content width — the ones the user opened after the first measurement. Such
   * a column is fitted even while the other widths are frozen: a width that was
   * never on screen cannot be a width the user has set, so fitting it moves
   * nothing they chose.
   */
  const measureColumns = React.useCallback(
    ({ unmeasuredOnly = false }: { unmeasuredOnly?: boolean } = {}) => {
      const tableElement = tableElementRef.current
      if (!tableElement) {
        return frozenRef.current
      }

      if (frozenRef.current && !unmeasuredOnly) {
        return true
      }

      const sizing = table.getState().columnSizing
      const applied = appliedRef.current

      if (
        applied &&
        Object.keys(applied).some((id) => sizing[id] !== applied[id])
      ) {
        frozenRef.current = true

        if (!unmeasuredOnly) {
          return true
        }
      }

      const measured: ColumnSizingState = {}
      let hasMeasurement = false

      for (const column of getMeasuredColumns(table)) {
        if (unmeasuredOnly && measuredIdsRef.current.has(column.id)) {
          continue
        }

        const contentWidth = measureColumnContentWidth(tableElement, column.id)
        if (contentWidth === undefined) {
          continue
        }

        const headerWidth = measureColumnHeaderWidth(tableElement, column.id)
        const fitWidth = Math.max(
          getContentFitWidth(column, contentWidth),
          headerWidth ?? 0
        )

        measuredIdsRef.current.add(column.id)
        measured[column.id] = fitWidth
        if (fitWidth !== column.getSize()) {
          hasMeasurement = true
        }
      }

      appliedRef.current = { ...applied, ...measured }

      if (hasMeasurement) {
        table.setColumnSizing((previous) => ({ ...previous, ...measured }))
      }

      return frozenRef.current
    },
    [table, tableElementRef]
  )

  // The columns the measurement is responsible for right now, and a key that
  // changes when they do. A column this table started out hiding shows up here
  // for the first time when the user opens it, and that is what asks for a
  // measurement the settle window would never make: it is how such a column gets
  // the width its own content needs instead of the one it declares.
  const measuredColumnIds = getMeasuredColumns(table).map((column) => column.id)
  const measuredColumnKey = measuredColumnIds.join(',')
  const hasMeasuredColumns = measuredColumnIds.length > 0

  React.useLayoutEffect(() => {
    if (!enabled || !hasMeasuredColumns || !tableElementRef.current) {
      return
    }

    startedRef.current = true
    measureColumns({ unmeasuredOnly: true })
  }, [
    enabled,
    hasMeasuredColumns,
    measureColumns,
    measuredColumnKey,
    table,
    tableElementRef,
  ])

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
