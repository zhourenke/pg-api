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

/**
 * Width of the container a measured clone sits in, and the offset it is parked
 * at. The container only has to be wider than any `min-width` a cell queries,
 * and the offset puts the whole thing to the left of the viewport, where it
 * cannot add anything to the page's own scrollable area.
 */
const MEASUREMENT_CONTAINER_WIDTH = 100000
const MEASUREMENT_OFFSET_LEFT = -200000

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

  // Every clone of a column goes into the box in one go, and only then are the
  // widths read: joining and leaving the document is what forces the browser to
  // recalculate styles and layout, so one join per column instead of one per cell
  // is most of what measuring a table costs.
  const box = getMeasurementBox()
  const clones = cells.map((cell) => createMeasurementClone(cell))

  // A stale containment from the previous column would answer a query this
  // column does not ask, so the box starts each column unconstrained.
  box.style.containerType = ''
  box.style.containerName = ''

  for (const { holder } of clones) {
    box.append(holder)
  }

  let measuredWidth = 0
  try {
    for (const { clone } of clones) {
      moveSizeContainment(clone, box)
    }

    for (const { clone } of clones) {
      const scrollWidth = clone.scrollWidth
      const offsetWidth = clone.offsetWidth
      const boundingWidth = Math.ceil(clone.getBoundingClientRect().width)
      measuredWidth = Math.max(
        measuredWidth,
        scrollWidth,
        offsetWidth,
        boundingWidth
      )
    }
  } finally {
    for (const { holder } of clones) {
      holder.remove()
    }
  }

  return measuredWidth > 0 ? Math.ceil(measuredWidth) : undefined
}

type MeasurementClone = {
  /** Wrapper the clone is measured inside; see {@link createMeasurementClone}. */
  holder: HTMLElement
  clone: HTMLElement
}

/**
 * Reads the width an element needs when nothing constrains it. The clone is
 * taken out of the table so the current column widths cannot influence the
 * result, and the resize handle is dropped so it never counts as content.
 *
 * Each clone gets its own wrapper: two table cells appended side by side would
 * be laid out as one anonymous row, where their widths would influence each
 * other instead of being read one by one.
 */
function createMeasurementClone(element: HTMLElement): MeasurementClone {
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

  clone.style.width = 'max-content'
  clone.style.minWidth = '0'
  clone.style.maxWidth = 'none'
  clone.style.height = 'auto'
  clone.style.whiteSpace = 'nowrap'

  const holder = document.createElement('div')
  holder.append(clone)

  return { holder, clone }
}

/**
 * The offscreen box measured clones are laid out in, created on first use and
 * then kept: the box itself is what costs, not the clone, and it stays out of
 * the page's own scrollable area. It is empty between measurements, and the
 * containment a cell needs is established on it per column (see
 * {@link moveSizeContainment}).
 *
 * The box is in the document, not beside it: a detached subtree reports no
 * computed `container-type`, so the containment could not be found before this
 * point.
 */
let measurementBox: HTMLElement | null = null

function getMeasurementBox(): HTMLElement {
  if (measurementBox?.isConnected) {
    return measurementBox
  }

  const box = document.createElement('div')
  box.style.position = 'absolute'
  box.style.left = `${MEASUREMENT_OFFSET_LEFT}px`
  box.style.top = '0'
  box.style.visibility = 'hidden'
  box.style.pointerEvents = 'none'
  box.style.width = `${MEASUREMENT_CONTAINER_WIDTH}px`

  document.body.append(box)
  measurementBox = box

  return box
}

/**
 * A cell that adapts to its own width with a container query establishes size
 * containment, and inline-size containment makes an element declare no width of
 * its own: cloned into an unconstrained box, such a cell measures as empty, so
 * its column would come out as narrow as its header and neither a drag nor a
 * double click could put the content back. The containment is lifted from the
 * clone and established on the box the measurement happens in instead, which is
 * deliberately wide, so a query inside the cell sees the room its content asks
 * for and content a narrow column drops still counts towards the width that is
 * measured.
 */
function moveSizeContainment(clone: HTMLElement, container: HTMLElement) {
  const containerNames = new Set<string>()

  for (const node of clone.querySelectorAll<HTMLElement>('*')) {
    const nodeStyles = window.getComputedStyle(node)

    if (!nodeStyles.containerType || nodeStyles.containerType === 'normal') {
      continue
    }

    if (nodeStyles.containerName && nodeStyles.containerName !== 'none') {
      containerNames.add(nodeStyles.containerName)
    }

    node.style.containerType = 'normal'
    node.style.containerName = 'none'
  }

  if (containerNames.size === 0) {
    return
  }

  container.style.containerType = 'inline-size'
  container.style.containerName = [...containerNames].join(' ')
}

function getColumnElementSelector(columnId: string) {
  const escapedColumnId =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(columnId)
      : columnId.replaceAll('\\', '\\\\').replaceAll('"', '\\"')

  return `[data-column-id="${escapedColumnId}"]`
}
