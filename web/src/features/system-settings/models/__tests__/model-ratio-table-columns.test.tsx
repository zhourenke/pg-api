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
import type { CellContext, Row } from '@tanstack/react-table'
import { render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { expect, it, vi } from 'vitest'

import type { ModelRow } from '../model-pricing-snapshots'
import { buildModelRatioColumns } from '../model-ratio-table-columns'

const t = (key: string) => key

function modelRow(): ModelRow {
  return {
    name: 'claude-sonnet',
    billingMode: 'ratio',
    ratio: '3',
    completionRatio: '5',
    cacheRatio: '0.1',
    hasConflict: false,
    isDraftChanged: false,
    isDraftDeleted: false,
    isDraftNew: false,
  }
}

function renderCell(columnId: string) {
  const column = buildModelRatioColumns({
    onDelete: vi.fn(),
    onEdit: vi.fn(),
    t,
  }).find((candidate) => candidate.id === columnId)

  if (!column?.cell) {
    throw new Error(`Column ${columnId} has no cell renderer`)
  }

  const cell = column.cell as (context: CellContext<ModelRow, unknown>) => ReactNode
  const row = { original: modelRow() } as unknown as Row<ModelRow>

  return render(<>{cell({ row } as CellContext<ModelRow, unknown>)}</>)
}

it('ellipsises both price lines instead of wrapping them', () => {
  const { container } = renderCell('priceSummary')

  const lines = [...container.querySelectorAll('span')]
  expect(lines).toHaveLength(2)
  for (const line of lines) {
    expect(line).toHaveClass('truncate')
  }

  // `truncate` only produces an ellipsis while the cell also clips its content.
  expect(lines[0].parentElement).toHaveClass('overflow-hidden')
  expect(lines[0].parentElement).toHaveClass('min-w-0')
})

it('centres the row actions and spaces them like every other actions column', () => {
  renderCell('actions')

  const editButton = screen.getByRole('button', { name: 'Edit' })
  const actions = editButton.parentElement

  expect(actions).toHaveClass('items-center')
  expect(actions).toHaveClass('justify-end')
  expect(actions).toHaveClass('gap-1')
  expect(
    within(actions as HTMLElement).getAllByRole('button')
  ).toHaveLength(2)
})
