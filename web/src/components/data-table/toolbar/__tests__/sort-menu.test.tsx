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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { DataTableSortMenu, type DataTableSortDirection } from '../sort-menu'

const OPTIONS = [
  { value: 'name', label: 'Model' },
  { value: 'input-price', label: 'Input price' },
] as const

describe('DataTableSortMenu', () => {
  it('names the field the table is sorted by and lists every option', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    render(
      <DataTableSortMenu
        options={OPTIONS}
        value='name'
        onValueChange={onValueChange}
        direction='asc'
        onDirectionChange={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Model' })
    expect(trigger).toBeVisible()

    await user.click(trigger)

    expect(
      await screen.findByRole('menuitem', { name: 'Input price' })
    ).toBeVisible()
    await user.click(screen.getByRole('menuitem', { name: 'Input price' }))
    expect(onValueChange).toHaveBeenCalledWith('input-price')
  })

  it('flips the direction and labels the arrow button with the direction it applies', async () => {
    const user = userEvent.setup()

    function Fixture() {
      const [direction, setDirection] =
        useState<DataTableSortDirection>('asc')
      return (
        <DataTableSortMenu
          options={OPTIONS}
          value='name'
          onValueChange={vi.fn()}
          direction={direction}
          onDirectionChange={setDirection}
        />
      )
    }

    render(<Fixture />)

    // Ascending shows the up arrow, and the button describes the action it
    // performs: the click sorts in the opposite direction.
    const ascending = screen.getByRole('button', { name: 'Sort ascending' })
    expect(ascending).toHaveAttribute('title', 'Sort ascending')
    await user.click(ascending)

    const descending = await screen.findByRole('button', {
      name: 'Sort descending',
    })
    expect(descending).toHaveAttribute('title', 'Sort descending')
    await user.click(descending)

    expect(
      await screen.findByRole('button', { name: 'Sort ascending' })
    ).toBeVisible()
  })

  it('reports the new direction through its callback', async () => {
    const user = userEvent.setup()
    const onDirectionChange = vi.fn()
    render(
      <DataTableSortMenu
        options={OPTIONS}
        value='name'
        onValueChange={vi.fn()}
        direction='asc'
        onDirectionChange={onDirectionChange}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Sort ascending' }))

    expect(onDirectionChange).toHaveBeenCalledWith('desc')
  })

  it('shows the Chinese direction label', () => {
    i18n.addResourceBundle('zhCN', 'translation', zh.translation, true, true)

    render(
      <DataTableSortMenu
        options={OPTIONS}
        value='name'
        onValueChange={vi.fn()}
        direction='desc'
        onDirectionChange={vi.fn()}
      />
    )

    // The field labels come from the caller, so only the direction is translated
    // by this control.
    expect(screen.getByRole('button', { name: '降序' })).toBeVisible()
  })
})
