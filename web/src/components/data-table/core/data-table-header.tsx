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
  flexRender,
  type Header,
  type Table as TanstackTable,
} from '@tanstack/react-table'
import * as React from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'

import { DataTableColumnHeader } from './column-header'
import {
  clampColumnSizeToFloor,
  FALLBACK_COLUMN_MIN_WIDTH,
  getContentFitWidth,
  measureColumnContentWidth,
  measureColumnHeaderWidth,
} from './column-measurement'
import { isContentSizedColumn, isFillerColumn } from './content-sized-columns'
import type { DataTableColumnClassName } from './types'

type DataTableHeaderProps<TData> = {
  table: TanstackTable<TData>
  applyHeaderSize?: boolean
  className?: string
  rowClassName?: string
  getColumnClassName?: DataTableColumnClassName
}

export function DataTableHeader<TData>({
  table,
  applyHeaderSize,
  className,
  rowClassName,
  getColumnClassName,
}: DataTableHeaderProps<TData>) {
  const { t } = useTranslation()
  const [resizingColumnId, setResizingColumnId] = React.useState<string | null>(
    null
  )

  return (
    <TableHeader className={className}>
      {table.getHeaderGroups().map((headerGroup) => (
        <TableRow key={headerGroup.id} className={rowClassName}>
          {headerGroup.headers.map((header) => (
            <TableHead
              key={header.id}
              colSpan={header.colSpan}
              data-column-id={header.column.id}
              aria-label={
                shouldRenderColumnResizer(table, header)
                  ? getColumnTitle(header)
                  : undefined
              }
              className={cn(
                'relative',
                getColumnClassName?.(header.column.id, 'header')
              )}
              style={getHeaderSizeStyle(header, applyHeaderSize)}
            >
              {renderHeaderContent(header)}
              {shouldRenderColumnResizer(table, header) && (
                <div
                  role='separator'
                  aria-orientation='vertical'
                  aria-label={t('Resize column')}
                  data-column-resizer
                  tabIndex={0}
                  onDoubleClick={(event) =>
                    handleColumnAutoSize(event, table, header)
                  }
                  onPointerDown={(event) =>
                    handleColumnResizeStart(event, table, header, {
                      onStart: () => setResizingColumnId(header.column.id),
                      onEnd: () => setResizingColumnId(null),
                    })
                  }
                  onKeyDown={(event) =>
                    handleColumnResizeKeyDown(event, table, header)
                  }
                  className={cn(
                    'absolute top-0 right-0 h-full w-2 cursor-col-resize touch-none select-none',
                    'after:bg-border hover:after:bg-primary after:absolute after:top-2 after:right-0 after:h-[calc(100%-1rem)] after:w-px after:transition-colors',
                    resizingColumnId === header.column.id && 'after:bg-primary'
                  )}
                />
              )}
            </TableHead>
          ))}
        </TableRow>
      ))}
    </TableHeader>
  )
}

function handleColumnResizeKeyDown<TData>(
  event: KeyboardEvent<HTMLDivElement>,
  table: TanstackTable<TData>,
  header: Header<TData, unknown>
) {
  const step = event.shiftKey ? 50 : 10

  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    resizeColumnByKeyboard(table, header, event.currentTarget, -step)
    return
  }

  if (event.key === 'ArrowRight') {
    event.preventDefault()
    resizeColumnByKeyboard(table, header, event.currentTarget, step)
    return
  }

  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    autoSizeColumn(event.currentTarget, table, header)
  }
}

function resizeColumnByKeyboard<TData>(
  table: TanstackTable<TData>,
  header: Header<TData, unknown>,
  resizerElement: HTMLElement,
  delta: number
) {
  const floor = getHeaderWidthFloor(resizerElement, header)

  table.setColumnSizing((previous) => ({
    ...previous,
    [header.column.id]: clampColumnSizeToFloor(
      header.column,
      header.column.getSize() + delta,
      floor
    ),
  }))
}

/**
 * Drags a header edge so the column tracks the pointer one to one, and stops at
 * the width where its own header would start to be cut off.
 */
function handleColumnResizeStart<TData>(
  event: PointerEvent<HTMLDivElement>,
  table: TanstackTable<TData>,
  header: Header<TData, unknown>,
  callbacks: { onStart: () => void; onEnd: () => void }
) {
  event.stopPropagation()

  const resizerElement = event.currentTarget
  // The press is deliberately not cancelled: that would also cancel the focus
  // the compatibility `mousedown` gives this element, leaving the separator
  // unreachable for arrow-key resizing. Focus has to come from the browser
  // rather than from a scripted call, because a scripted focus is drawn as a
  // `:focus-visible` ring when nothing has been clicked yet, such as just after
  // a reload. The selection the drag needs to suppress is handled by `userSelect`.
  const floor = getHeaderWidthFloor(resizerElement, header)
  const startX = event.clientX
  const startSize = header.column.getSize()
  const columnId = header.column.id
  const { onStart, onEnd } = callbacks

  onStart()
  const previousUserSelect = document.body.style.userSelect
  document.body.style.userSelect = 'none'

  const handleMove = (moveEvent: globalThis.PointerEvent) => {
    const nextSize = startSize + (moveEvent.clientX - startX)

    table.setColumnSizing((previous) => ({
      ...previous,
      [columnId]: clampColumnSizeToFloor(header.column, nextSize, floor),
    }))
  }

  const handleEnd = () => {
    window.removeEventListener('pointermove', handleMove)
    window.removeEventListener('pointerup', handleEnd)
    window.removeEventListener('pointercancel', handleEnd)
    window.removeEventListener('blur', handleEnd)
    document.body.style.userSelect = previousUserSelect
    onEnd()
  }

  // Listening on the window (and on blur) ends the drag even when the pointer is
  // released outside the table or the window loses focus mid-drag.
  window.addEventListener('pointermove', handleMove)
  window.addEventListener('pointerup', handleEnd)
  window.addEventListener('pointercancel', handleEnd)
  window.addEventListener('blur', handleEnd)
}

function handleColumnAutoSize<TData>(
  event: MouseEvent<HTMLDivElement>,
  table: TanstackTable<TData>,
  header: Header<TData, unknown>
) {
  event.preventDefault()
  autoSizeColumn(event.currentTarget, table, header)
}

/**
 * Fits a column to its content. The same measurement decides the width a column
 * starts with, so double-clicking restores the default look.
 */
function autoSizeColumn<TData>(
  resizerElement: HTMLElement,
  table: TanstackTable<TData>,
  header: Header<TData, unknown>
) {
  const tableElement = resizerElement.closest('table')
  const measuredSize = tableElement
    ? measureColumnContentWidth(tableElement, header.column.id)
    : undefined

  if (measuredSize === undefined) {
    return
  }

  const floor = getHeaderWidthFloor(resizerElement, header)

  table.setColumnSizing((previous) => ({
    ...previous,
    [header.column.id]: clampColumnSizeToFloor(
      header.column,
      getContentFitWidth(header.column, measuredSize),
      floor
    ),
  }))
}

function getHeaderWidthFloor<TData>(
  resizerElement: HTMLElement,
  header: Header<TData, unknown>
) {
  const tableElement = resizerElement.closest('table')
  const headerWidth = tableElement
    ? measureColumnHeaderWidth(tableElement, header.column.id)
    : undefined

  return headerWidth ?? FALLBACK_COLUMN_MIN_WIDTH
}

function shouldRenderColumnResizer<TData>(
  table: TanstackTable<TData>,
  header: Header<TData, unknown>
) {
  return (
    table.options.enableColumnResizing === true &&
    !header.isPlaceholder &&
    header.column.getCanResize() &&
    !isContentSizedColumn(header.column.id)
  )
}

function getHeaderSizeStyle<TData>(
  header: Header<TData, unknown>,
  applyHeaderSize: boolean | undefined
) {
  // The spacer column must stay unsized, otherwise a `width: 0` header cell
  // would take precedence over its empty colgroup entry and collapse it.
  if (
    !applyHeaderSize ||
    isContentSizedColumn(header.column.id) ||
    isFillerColumn(header.column.id)
  ) {
    return undefined
  }

  return { width: header.getSize() }
}

function renderHeaderContent<TData>(header: Header<TData, unknown>) {
  if (header.isPlaceholder) return null

  const title = getColumnTitle(header)

  if (title) {
    return <DataTableColumnHeader column={header.column} title={title} />
  }

  return flexRender(header.column.columnDef.header, header.getContext())
}

/**
 * A string header (or `meta.label`) is the column's own title. It is also what
 * the header cell must expose as its accessible name once a resize separator is
 * rendered inside it, because that separator would otherwise be appended to the
 * column header's computed name.
 */
function getColumnTitle<TData>(header: Header<TData, unknown>) {
  const { header: headerDef, meta } = header.column.columnDef

  if (typeof headerDef === 'string') {
    return headerDef
  }

  return meta?.label
}
