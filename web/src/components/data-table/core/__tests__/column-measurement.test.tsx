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
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  measureColumnContentWidth,
  measureColumnHeaderWidth,
} from '../column-measurement'

describe('column-measurement', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    document.body.innerHTML = ''
  })

  it('measures cells inside a contextual wrapper preserving table classes and data-slot', () => {
    const container = document.createElement('div')
    container.className = 'scoped-table-container custom-typography'

    const table = document.createElement('table')
    table.className = 'custom-table-class'
    table.setAttribute('data-slot', 'table')

    const tbody = document.createElement('tbody')
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.setAttribute('data-column-id', 'test_col')
    td.textContent = 'Hello World'

    tr.append(td)
    tbody.append(tr)
    table.append(tbody)
    container.append(table)
    document.body.append(container)

    let capturedMockTable: HTMLTableElement | null = null
    let capturedHolder: HTMLElement | null = null

    // Spy on append on HTMLElement to inspect the measurement clones placed in the measurement box
    const originalAppend = HTMLElement.prototype.append
    vi.spyOn(HTMLElement.prototype, 'append').mockImplementation(function (
      this: HTMLElement,
      ...nodes: (Node | string)[]
    ) {
      for (const node of nodes) {
        if (node instanceof HTMLElement && node.querySelector('table')) {
          capturedHolder = node
          capturedMockTable = node.querySelector('table')
        }
      }
      return originalAppend.apply(this, nodes)
    })

    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(120)

    const measured = measureColumnContentWidth(table, 'test_col')

    expect(measured).toBe(120)
    expect(capturedHolder).toBeInstanceOf(HTMLElement)
    expect((capturedHolder as HTMLElement | null)?.className).toBe(
      'scoped-table-container custom-typography'
    )
    expect(capturedMockTable).toBeInstanceOf(HTMLTableElement)
    expect((capturedMockTable as HTMLTableElement | null)?.className).toBe(
      'custom-table-class'
    )
    expect(
      (capturedMockTable as HTMLTableElement | null)?.getAttribute('data-slot')
    ).toBe('table')
  })

  it('measures header cells correctly via measureColumnHeaderWidth', () => {
    const table = document.createElement('table')
    table.setAttribute('data-slot', 'table')

    const thead = document.createElement('thead')
    const tr = document.createElement('tr')
    const th = document.createElement('th')
    th.setAttribute('data-column-id', 'header_col')
    th.textContent = 'Column Title'

    tr.append(th)
    thead.append(tr)
    table.append(thead)
    document.body.append(table)

    vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(85)

    const measured = measureColumnHeaderWidth(table, 'header_col')
    expect(measured).toBe(85)
  })

  it('returns undefined when no matching cells exist in the table', () => {
    const table = document.createElement('table')
    document.body.append(table)

    expect(measureColumnContentWidth(table, 'non_existent')).toBeUndefined()
  })
})
