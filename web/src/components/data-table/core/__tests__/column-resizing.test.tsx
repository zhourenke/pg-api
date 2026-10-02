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
import { fireEvent, render, screen } from '@testing-library/react'
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

function Harness({ names = ['alpha'] }: { names?: string[] }) {
  const { table } = useDataTable({
    data: names.map((name, index) => ({ id: index + 1, name })),
    columns,
  })

  return <DataTableView table={table} applyHeaderSize />
}

function getColumnWidths() {
  return [...screen.getByRole('table').querySelectorAll('col')].map(
    (col) => (col as HTMLElement).style.width
  )
}

/**
 * jsdom does not lay anything out, so `scrollWidth` is always 0 and the real
 * measurement would look like empty content. A deterministic stand-in keeps the
 * production measuring code in play.
 */
const CHARACTER_WIDTH = 8

function stubScrollingWidth() {
  return vi
    .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      return (this.textContent ?? '').trim().length * CHARACTER_WIDTH
    })
}

async function dragSeparator(
  separator: HTMLElement,
  from: number,
  to: number
) {
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

  it('keeps the column header’s accessible name when a resize separator is present', () => {
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

  it('keeps the measured widths when the page changes', () => {
    stubScrollingWidth()
    const view = render(<Harness names={['alpha']} />)
    expect(getColumnWidths()[0]).toBe('56px')

    view.rerender(
      <Harness names={['a-much-longer-model-name-that-would-not-fit']} />
    )

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
