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
import type { ColumnDef } from '@tanstack/react-table'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DataTableView, useDataTable } from '@/components/data-table'

type Row = { id: number; name: string }

const columns: ColumnDef<Row>[] = [
  { accessorKey: 'name', header: 'Name', size: 220, minSize: 120 },
  {
    id: 'actions',
    header: 'Actions',
    size: 120,
    cell: () => <button type='button'>Edit</button>,
  },
]

/**
 * Mirrors the model list, whose name cell answers its own container query: the
 * provider icon appears once the cell is wide enough for it.
 */
const containerColumns: ColumnDef<Row>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 220,
    cell: ({ row }) => (
      <div style={{ containerType: 'inline-size', containerName: 'cell' }}>
        <span>{row.original.name}</span>
      </div>
    ),
  },
  {
    id: 'actions',
    header: 'Actions',
    size: 120,
    cell: () => <button type='button'>Edit</button>,
  },
]

/**
 * Mirrors a column that shows a window onto content of its own length — the
 * upstream error a channel test summarizes, the one-line preview of a log's
 * details — where the content itself is never the width the column needs.
 */
const windowColumns: ColumnDef<Row>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 320,
    meta: { measurement: 'window' },
  },
  {
    id: 'actions',
    header: 'Actions',
    size: 120,
    cell: () => <button type='button'>Edit</button>,
  },
]

function Harness({
  names = ['alpha'],
  tableColumns = columns,
  isLoading,
}: {
  names?: string[]
  tableColumns?: ColumnDef<Row>[]
  isLoading?: boolean
}) {
  const { table } = useDataTable({
    data: names.map((name, index) => ({ id: index + 1, name })),
    columns: tableColumns,
  })

  return <DataTableView table={table} applyHeaderSize isLoading={isLoading} />
}

function getColumnWidths() {
  return [...screen.getByRole('table').querySelectorAll('col')].map(
    (col) => (col as HTMLElement).style.width
  )
}

function getHeaderWidths() {
  return screen
    .getAllByRole('columnheader')
    .map((header) => (header as HTMLElement).style.width)
}

/**
 * jsdom does not lay anything out, so `scrollWidth` is always 0 and the real
 * measurement would look like empty content. A deterministic stand-in keeps the
 * production measuring code in play. It also carries the one rule that decides a
 * measurement with no layout at all: inline-size containment, which makes the
 * contents of a size container invisible to the box around it.
 */
const CHARACTER_WIDTH = 8

function stubScrollingWidth() {
  return vi
    .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      const insideActiveContainer = [...this.querySelectorAll('*')].some(
        (node) => {
          const containerType = window.getComputedStyle(node).containerType

          return containerType !== '' && containerType !== 'normal'
        }
      )

      if (insideActiveContainer) {
        return 0
      }

      return (this.textContent ?? '').trim().length * CHARACTER_WIDTH
    })
}

/**
 * Counts how often a render reaches the document with the box a measured clone
 * is laid out in. `scrollWidth` stands in for layout here, so this is the only
 * cost a jsdom render can show: the number of joins, not their duration.
 */
function countBodyMeasurementJoins(names: string[]) {
  const originalAppend = Element.prototype.append
  const joined: Node[] = []

  Element.prototype.append = function (this: Element, ...nodes: Node[]) {
    if (this === document.body) {
      joined.push(...nodes)
    }

    return originalAppend.apply(this, nodes)
  }

  try {
    render(<Harness names={names} />)
  } finally {
    Element.prototype.append = originalAppend
  }

  return joined.filter(
    (node) => node instanceof HTMLElement && node.style.position === 'absolute'
  ).length
}

async function dragSeparator(separator: HTMLElement, from: number, to: number) {
  const originalPointerEvent = window.PointerEvent
  // jsdom ships no PointerEvent, and the generic fallback drops `clientX`,
  // which is the only thing a resize drag reads.
  window.PointerEvent = MouseEvent as unknown as typeof PointerEvent

  try {
    fireEvent.pointerDown(separator, { clientX: from })
    fireEvent.pointerMove(document, { clientX: to })
    fireEvent.pointerUp(document)
  } finally {
    window.PointerEvent = originalPointerEvent
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  window.localStorage.clear()
})

describe('column resizing', () => {
  it('sizes every column from the declared widths and closes the table with a spacer', () => {
    render(<Harness />)

    // `name` and `actions` keep the pixel width they declare, and the trailing
    // spacer carries no width at all: the browser hands it whatever the sized
    // columns leave over, so the table still fills its container.
    expect(getColumnWidths()).toEqual(['220px', '', '120px'])
    const table = screen.getByRole('table')
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.style.minWidth).toBe('max(100%, 340px)')
  })

  it('renders an even frame while the rows are still loading', () => {
    render(<Harness names={['alpha']} isLoading />)

    // There is nothing to measure yet, so no column holds a width: the frame
    // shares the table evenly and can no longer be wider than its container,
    // which is where the declared widths used to leave it.
    expect(getColumnWidths()).toEqual(['', '0px', ''])
    const table = screen.getByRole('table')
    expect(table.style.tableLayout).toBe('fixed')
    expect(table.style.width).toBe('100%')
    expect(table.style.minWidth).toBe('')

    // The declared widths are not on the header cells either, where a fixed
    // layout would read them as the widths of the columns.
    expect(getHeaderWidths()).toEqual(['', '', ''])
  })

  it('keeps the even frame when a filter leaves the table without rows', () => {
    render(<Harness names={[]} />)

    expect(getColumnWidths()).toEqual(['', '0px', ''])
    expect(screen.getByRole('table').style.minWidth).toBe('')
  })

  it('keeps a window column at the width it declares instead of measuring it', () => {
    stubScrollingWidth()
    render(
      <Harness
        names={['alpha-with-a-much-longer-name']}
        tableColumns={windowColumns}
      />
    )

    // The content would measure 29 characters wide, but a window column shows a
    // window onto it rather than the content itself, so the declared width is
    // what it keeps. The columns beside it are still fitted to their content.
    expect(getColumnWidths()).toEqual(['320px', '', '72px'])
  })

  it('keeps every other column width when a single column is dragged', async () => {
    render(<Harness />)

    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.setup().keyboard('{ArrowRight}')

    expect(getColumnWidths()).toEqual(['230px', '', '120px'])
  })

  it('renders a keyboard-resizable separator for resizable columns only', async () => {
    render(<Harness />)

    const separators = screen.getAllByRole('separator')
    expect(separators).toHaveLength(1)
    expect(separators[0]).toHaveAttribute('aria-label', 'Resize column')

    const user = userEvent.setup()
    separators[0].focus()
    await user.keyboard('{ArrowRight}')

    expect(getColumnWidths()[0]).toBe('230px')
  })

  it('never persists the adjusted width', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    render(<Harness />)

    const separator = screen.getByRole('separator')
    separator.focus()
    await userEvent.setup().keyboard('{ArrowRight}')

    expect(getColumnWidths()[0]).toBe('230px')
    expect(setItem).not.toHaveBeenCalled()
  })

  it('keeps the column header鈥檚 accessible name when a resize separator is present', () => {
    render(<Harness />)

    expect(screen.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    expect(
      screen.queryByRole('columnheader', { name: /Resize column/ })
    ).not.toBeInTheDocument()
  })

  it('leaves the spacer column out of the header sizes', () => {
    render(<Harness />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers).toHaveLength(3)
    // A zero width here would beat the empty colgroup entry and collapse the
    // spacer, which is what keeps the table flush with its container.
    expect(headers[1].style.width).toBe('')
  })

  it('does not offer resizing on narrow viewports', () => {
    const originalMatchMedia = window.matchMedia
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
      ...originalMatchMedia(query),
      matches: query === '(max-width: 640px)',
    }))

    render(<Harness />)

    expect(screen.queryByRole('separator')).not.toBeInTheDocument()
  })

  it('starts every column at the width its own content needs', () => {
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)

    // `alpha` needs 5 characters, `Name` needs 4, plus the breathing space; the
    // actions column needs its widest cell (`Actions`), not the declared 120px.
    expect(getColumnWidths()).toEqual(['56px', '', '72px'])
  })

  it('measures the content a cell hides behind its own container query', () => {
    stubScrollingWidth()
    render(
      <Harness names={['alpha-model-name']} tableColumns={containerColumns} />
    )

    // The cell establishes a size container for its own query, and containment
    // makes the box around it look empty, so a measurement that does not lift it
    // leaves the column at its header width instead of the 16 characters of the
    // name the column has to show.
    expect(getColumnWidths()).toEqual(['144px', '', '72px'])
  })

  it('measures a whole table through one offscreen box, not one per cell', () => {
    stubScrollingWidth()

    // Five rows and two measured columns ask for twelve clones. They are all
    // measured inside one box for the whole table: a join of the document is what
    // forces a style and layout pass, so a box per clone made a wide table block
    // the page for seconds while it settled.
    expect(
      countBodyMeasurementJoins(['alpha', 'beta', 'gamma', 'delta', 'eta'])
    ).toBeLessThanOrEqual(1)
  })

  it('re-measures a cell whose content only arrives after the first paint', () => {
    vi.useFakeTimers()
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)
    expect(getColumnWidths()[0]).toBe('56px')

    // A price whose currency arrives with the system configuration renders its
    // numbers late; measuring only the first paint kept the column too narrow.
    act(() => {
      screen.getByText('alpha').textContent = 'alpha-with-a-late-width'
      vi.advanceTimersByTime(250)
    })

    expect(getColumnWidths()[0]).toBe('200px')
  })

  it('keeps the measured widths once the table has settled', async () => {
    vi.useFakeTimers()
    stubScrollingWidth()
    const view = render(<Harness names={['alpha']} />)
    expect(getColumnWidths()[0]).toBe('56px')

    act(() => {
      vi.advanceTimersByTime(3000)
    })

    view.rerender(
      <Harness names={['a-much-longer-model-name-that-would-not-fit']} />
    )
    await act(async () => {})

    expect(getColumnWidths()).toEqual(['56px', '', '72px'])
  })

  it('tracks the pointer while dragging and stops at the header width', async () => {
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)

    await dragSeparator(screen.getByRole('separator'), 200, 260)
    expect(getColumnWidths()[0]).toBe('116px')

    // `Name` is the floor: the column may not shrink past its own header.
    await dragSeparator(screen.getByRole('separator'), 260, 0)
    expect(getColumnWidths()[0]).toBe('32px')
    expect(getColumnWidths()[2]).toBe('72px')
  })

  it('restores the measured default width on double click', async () => {
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)

    await dragSeparator(screen.getByRole('separator'), 200, 400)
    expect(getColumnWidths()[0]).toBe('256px')

    fireEvent.doubleClick(screen.getByRole('separator'))
    expect(getColumnWidths()[0]).toBe('56px')
  })

  it('lets the browser focus the separator on a press so arrow keys can resize it', () => {
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)

    const separator = screen.getByRole('separator')

    // An uncancelled press is what lets `mousedown` focus the separator. A
    // scripted focus would draw a focus ring after a reload, where the browser
    // still treats the script as the last input modality.
    expect(fireEvent.pointerDown(separator, { clientX: 200 })).toBe(true)
    fireEvent.pointerUp(window)

    separator.focus()
    fireEvent.keyDown(separator, { key: 'ArrowRight' })
    expect(getColumnWidths()[0]).toBe('66px')
  })

  it('stops resizing when the window loses focus mid-drag', async () => {
    stubScrollingWidth()
    render(<Harness names={['alpha']} />)

    const originalPointerEvent = window.PointerEvent
    window.PointerEvent = MouseEvent as unknown as typeof PointerEvent

    try {
      fireEvent.pointerDown(screen.getByRole('separator'), { clientX: 200 })
      fireEvent.pointerMove(window, { clientX: 260 })
      fireEvent.blur(window)
      fireEvent.pointerMove(window, { clientX: 400 })
    } finally {
      window.PointerEvent = originalPointerEvent
    }

    expect(getColumnWidths()[0]).toBe('116px')
  })
})
