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

import zh from '@/i18n/locales/zh.json'

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
    t,
  }).find((candidate) => candidate.id === columnId)

  if (!column?.cell) {
    throw new Error(`Column ${columnId} has no cell renderer`)
  }

  const cell = column.cell as (
    context: CellContext<ModelRow, unknown>
  ) => ReactNode
  const row = { original: modelRow() } as unknown as Row<ModelRow>

  return render(<>{cell({ row } as CellContext<ModelRow, unknown>)}</>)
}

it('shows the base tier prices through the shared model list cell', () => {
  renderCell('priceSummary')

  // 与【模型】管理页一致：base 档的输入/输出/缓存读取，每 1M Token、站点货币。
  for (const label of screen.getAllByText(/^(Input|Output|Cache Read)$/)) {
    const line = label.parentElement?.parentElement
    // 挤压时逐行省略号，不换行（与【模型】页同一契约）。
    expect(line).toHaveClass('truncate')
    expect(line?.className).not.toContain('flex-wrap')
  }

  expect(screen.getByText('Input')).toBeVisible()
  expect(screen.getByText('Output')).toBeVisible()
  expect(screen.getByText('Cache Read')).toBeVisible()
})

it('no longer offers a billing mode column', () => {
  const columns = buildModelRatioColumns({
    onDelete: vi.fn(),
    t,
  })

  expect(
    columns.map(
      (column) => (column as { accessorKey?: string }).accessorKey ?? column.id
    )
  ).not.toContain('billingMode')
})

it('offers delete only, because the row itself opens the editor', () => {
  renderCell('actions')

  const deleteButton = screen.getByRole('button', { name: 'Delete' })
  const actions = deleteButton.parentElement

  expect(actions).toHaveClass('items-center')
  expect(actions).toHaveClass('justify-end')
  expect(actions).toHaveClass('gap-1')
  expect(within(actions as HTMLElement).getAllByRole('button')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
})

it('keeps only the model identity columns for the unset price page', () => {
  const columns = buildModelRatioColumns({
    onDelete: vi.fn(),
    identityOnly: true,
    t,
  })

  expect(columns.map((column) => column.id)).toEqual(['select', 'name'])
})

it('names the price column 价格 in the header and in the column menu', () => {
  // 列头与列菜单（`meta.label`）读同一个键，所以两者是同一份文案；owner 定的
  // 最终文案是「价格」，这里用真实词条把两个落点一起钉住。
  const zhT = (key: string) =>
    (zh.translation as Record<string, string>)[key] ?? key
  const column = buildModelRatioColumns({
    onDelete: vi.fn(),
    t: zhT,
  }).find((candidate) => candidate.id === 'priceSummary')

  expect(zhT('Price summary')).toBe('价格')
  expect(column?.meta?.label).toBe('价格')
})
