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
import type { Column } from '@tanstack/react-table'

/**
 * Room left on top of the measured text so a column does not look cramped. The
 * measuring clone already includes the cell padding, so this is only breathing
 * space.
 */
const COLUMN_WIDTH_PADDING = 16

/**
 * Only used when a column's header cannot be measured at all (a custom header
 * cell with no text), so that a drag can still not collapse the column.
 */
export const FALLBACK_COLUMN_MIN_WIDTH = 56

/** Measured width of the widest cell in a column, header included. */
export function measureColumnContentWidth(
  tableElement: HTMLElement,
  columnId: string
): number | undefined {
  return measureCells(tableElement, getColumnElementSelector(columnId))
}

/**
 * Widest text of a column's own header. This is the width below which the
 * header would be cut off, so it is the floor a drag may not cross.
 */
export function measureColumnHeaderWidth(
  tableElement: HTMLElement,
  columnId: string
): number | undefined {
  return measureCells(tableElement, `th${getColumnElementSelector(columnId)}`)
}

/**
 * The width a column needs to show its own content without wrapping. A declared
 * maximum still wins, but a declared minimum does not: the header measurement is
 * the real floor, so a hand-written minimum cannot inflate the default width.
 */
export function getContentFitWidth<TData>(
  column: Column<TData, unknown>,
  measuredWidth: number
): number {
  return clampColumnSize(
    column,
    Math.ceil(measuredWidth) + COLUMN_WIDTH_PADDING
  )
}

function clampColumnSize<TData>(
  column: Column<TData, unknown>,
  size: number
): number {
  const { maxSize } = column.columnDef

  if (typeof maxSize === 'number' && size > maxSize) {
    return maxSize
  }

  return size
}

/** Clamps a width to a floor that was measured from the table itself. */
export function clampColumnSizeToFloor<TData>(
  column: Column<TData, unknown>,
  size: number,
  floor: number
): number {
  return clampColumnSize(column, Math.max(size, floor))
}

function measureCells(
  tableElement: HTMLElement,
  selector: string
): number | undefined {
  const cells = [...tableElement.querySelectorAll<HTMLElement>(selector)]
  if (cells.length === 0) {
    return undefined
  }

  const measuredWidth = cells.reduce(
    (maxWidth, cell) => Math.max(maxWidth, measureElementWidth(cell)),
    0
  )

  return measuredWidth > 0 ? Math.ceil(measuredWidth) : undefined
}

/**
 * Reads the width an element needs when nothing constrains it. The clone is
 * taken out of the table so the current column widths cannot influence the
 * result, and the resize handle is dropped so it never counts as content.
 */
function measureElementWidth(element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement

  clone.querySelectorAll('[data-column-resizer]').forEach((resizer) => {
    resizer.remove()
  })

  // The clone is measured outside the table, where the styles the table applies
  // to its own cells no longer reach it, so the text would be measured at the
  // page's font settings instead of the table's. Copying the typography keeps the
  // measurement comparable with the column as it is rendered.
  const styles = window.getComputedStyle(element)
  clone.style.fontSize = styles.fontSize
  clone.style.fontFamily = styles.fontFamily
  clone.style.fontWeight = styles.fontWeight
  clone.style.letterSpacing = styles.letterSpacing
  clone.style.fontVariantNumeric = styles.fontVariantNumeric

  clone.style.position = 'absolute'
  clone.style.visibility = 'hidden'
  clone.style.pointerEvents = 'none'
  clone.style.left = '-10000px'
  clone.style.top = '0'
  clone.style.width = 'max-content'
  clone.style.minWidth = '0'
  clone.style.maxWidth = 'none'
  clone.style.height = 'auto'
  clone.style.whiteSpace = 'nowrap'

  document.body.append(clone)
  const width = clone.scrollWidth
  clone.remove()

  return width
}

function getColumnElementSelector(columnId: string) {
  const escapedColumnId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(columnId)
      : columnId.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

  return `[data-column-id="${escapedColumnId}"]`
}
