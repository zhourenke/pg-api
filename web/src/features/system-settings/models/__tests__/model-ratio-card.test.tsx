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
import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type { ModelRow } from '../model-pricing-snapshots'
import { ModelRatioCard } from '../model-ratio-card'

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

function renderCard(options?: { identityOnly?: boolean }) {
  const onDelete = vi.fn()
  const onOpen = vi.fn()
  const view = render(
    <ModelRatioCard
      model={modelRow()}
      onDelete={onDelete}
      onOpen={onOpen}
      identityOnly={options?.identityOnly}
    />
  )
  const card = view.container.querySelector<HTMLElement>(
    '[data-slot="model-ratio-card"]'
  )
  if (!card) throw new Error('card root is missing')

  return { card, onDelete, onOpen }
}

it('shares the title row between the model name and the delete action, and puts the price on the next row', () => {
  const { card } = renderCard()
  // 标题行：左列是模型名，右列是删除。价格不进右列，所以它独占左列的下一行。
  const [identityColumn, actionColumn] = [...card.children]
  expect(identityColumn.children).toHaveLength(2)
  const [titleRow, priceRow] = [...identityColumn.children]
  expect(titleRow).toContainElement(screen.getByText('claude-sonnet'))
  expect(priceRow).toContainElement(screen.getByText('Input'))
  expect(priceRow).toContainElement(screen.getByText('Cache Read'))
  expect(priceRow).not.toContainElement(
    screen.getByRole('button', { name: 'Delete' })
  )
  expect(actionColumn).toContainElement(
    screen.getByRole('button', { name: 'Delete' })
  )
  // 卡片不再是「标签在左、值在右」那一版：价格行没有自己的标签。
  expect(screen.queryByText('Price summary')).toBeNull()
})

it('drops both the price and the delete action when the page only lists unset prices', () => {
  const { card } = renderCard({ identityOnly: true })

  expect(card).toContainElement(screen.getByText('claude-sonnet'))
  expect(screen.queryByText('Input')).toBeNull()
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
})

it('asks for the deleted model by name', () => {
  const { onDelete } = renderCard()

  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  expect(onDelete).toHaveBeenCalledWith('claude-sonnet')
})

it('opens the editor when the card body is tapped', () => {
  const { onOpen } = renderCard()

  fireEvent.click(screen.getByText('claude-sonnet'))

  expect(onOpen).toHaveBeenCalledTimes(1)
})

it('leaves a tap on the delete action to that action alone', () => {
  const { onDelete, onOpen } = renderCard()

  // 整卡可点之后，删除按钮的点击会冒泡到卡片：不挡住它就会连带打开定价面板。
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

  expect(onDelete).toHaveBeenCalledWith('claude-sonnet')
  expect(onOpen).not.toHaveBeenCalled()
})

it('keeps the card tappable on the page that only lists unset prices', () => {
  const { onOpen } = renderCard({ identityOnly: true })

  fireEvent.click(screen.getByText('claude-sonnet'))

  expect(onOpen).toHaveBeenCalledTimes(1)
})
