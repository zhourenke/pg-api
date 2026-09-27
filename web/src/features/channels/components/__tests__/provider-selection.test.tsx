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
import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createInstance } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { expect, test, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'

import { ChannelProviderPicker } from '../drawers/channel-provider-picker'

test('creation hides legacy Zhipu from categories and numeric search while GLM remains selectable', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(
    <ChannelProviderPicker
      isCreating
      currentProvider={{ kind: 'builtin', type: 16 }}
      disabled={false}
      onSelect={select}
    />
  )
  expect(screen.queryByRole('option', { name: /#16$/ })).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Built-in' }))
  const search = screen.getByRole('combobox')
  await user.type(search, 'zhi')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  await user.click(
    screen.getByRole('option', { name: 'Zhipu GLM Built-in #26' })
  )
  expect(select).toHaveBeenCalledWith({ kind: 'builtin', type: 26 })
  await user.clear(search)
  await user.type(search, '16')
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'All' }))
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
})

test('editing an existing legacy Zhipu channel retains its selectable provider', async () => {
  const user = userEvent.setup()
  const select = vi.fn()
  render(
    <ChannelProviderPicker
      isCreating={false}
      currentProvider={{ kind: 'builtin', type: 16 }}
      disabled={false}
      onSelect={select}
    />
  )
  await user.type(screen.getByRole('combobox'), '16')
  const legacy = screen.getByRole('option', { name: 'Zhipu Built-in #16' })
  expect(legacy).toHaveAttribute('aria-current', 'true')
  await user.click(legacy)
  expect(select).toHaveBeenCalledWith({ kind: 'builtin', type: 16 })
})

test('Zhipu GLM uses the renamed Chinese label and remains searchable after changing language', async () => {
  const language = createInstance()
  await language.init({
    lng: 'zhCN',
    fallbackLng: 'zhCN',
    resources: { zhCN: { translation: {} }, zh },
  })
  const user = userEvent.setup()
  render(
    <I18nextProvider i18n={language}>
      <ChannelProviderPicker isCreating disabled={false} onSelect={vi.fn()} />
    </I18nextProvider>
  )
  await user.type(screen.getByRole('combobox'), 'GLM')
  expect(
    screen.getByRole('option', { name: 'Zhipu GLM Built-in #26' })
  ).toBeVisible()
  await act(() => language.changeLanguage('zh'))
  expect(screen.getByRole('option', { name: '智谱GLM 内置 #26' })).toBeVisible()
})

test('custom providers have their own tab and keep the search when switching categories', async () => {
  const user = userEvent.setup()
  render(<ChannelProviderPicker disabled={false} onSelect={vi.fn()} />)
  const tabs = screen.getByRole('tablist', { name: 'Provider source' })
  expect(within(tabs).getAllByRole('tab')).toHaveLength(4)
  await user.click(within(tabs).getByRole('tab', { name: 'Custom' }))
  const panel = screen.getByRole('tabpanel', { name: 'Custom' })
  expect(within(panel).getAllByRole('option')).toHaveLength(2)
  expect(
    within(panel).getByRole('option', { name: 'Advanced Custom Built-in #58' })
  ).toBeVisible()
  expect(
    within(panel).getByRole('option', { name: 'Custom Built-in #8' })
  ).toBeVisible()

  await user.click(within(tabs).getByRole('tab', { name: 'Built-in' }))
  expect(
    screen.getByRole('option', { name: 'OpenAI Built-in #1' })
  ).toBeVisible()
  expect(
    screen.queryByRole('option', { name: 'Advanced Custom Built-in #58' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('option', { name: 'Custom Built-in #8' })
  ).not.toBeInTheDocument()
  await user.type(screen.getByRole('combobox'), '58')
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await user.click(within(tabs).getByRole('tab', { name: 'Custom' }))
  expect(screen.getByRole('combobox')).toHaveValue('58')
  expect(screen.getAllByRole('option')).toHaveLength(1)
  expect(
    screen.getByRole('option', { name: 'Advanced Custom Built-in #58' })
  ).toBeVisible()
})

test('category tabs use arrow and Enter navigation without moving focus into the search field', async () => {
  const user = userEvent.setup()
  render(<ChannelProviderPicker disabled={false} onSelect={vi.fn()} />)
  const all = screen.getByRole('tab', { name: 'All' })
  const builtin = screen.getByRole('tab', { name: 'Built-in' })
  await user.click(all)
  await user.keyboard('{ArrowRight}')
  expect(builtin).toHaveFocus()
  expect(all).toHaveAttribute('aria-selected', 'true')
  await user.keyboard('{Enter}')
  expect(builtin).toHaveAttribute('aria-selected', 'true')
  expect(builtin).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: 'Built-in' })).toHaveAttribute(
    'id',
    builtin.getAttribute('aria-controls')
  )

  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('tab', { name: 'Gateways' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: 'Gateways' })).toBeVisible()
  await user.keyboard('{ArrowRight}{Enter}')
  expect(screen.getByRole('tab', { name: 'Custom' })).toHaveFocus()
  expect(screen.getByRole('tabpanel', { name: 'Custom' })).toBeVisible()
})

test('every built-in provider has a description and Anthropic includes compatible services', async () => {
  const language = createInstance()
  await language.init({
    lng: 'zhCN',
    fallbackLng: 'zhCN',
    resources: { zhCN: { translation: {} }, zh },
  })
  render(
    <I18nextProvider i18n={language}>
      <ChannelProviderPicker disabled={false} onSelect={vi.fn()} />
    </I18nextProvider>
  )

  for (const option of screen.getAllByRole('option')) {
    expect(option).toHaveAccessibleDescription()
  }
  const anthropic = screen.getByRole('option', {
    name: 'Anthropic Built-in #14',
  })
  expect(anthropic).toHaveAccessibleDescription(
    'Connect to the Anthropic API or compatible services'
  )
  await act(() => language.changeLanguage('zh'))
  expect(anthropic).toHaveAccessibleDescription(
    '接入 Anthropic API 或兼容其接口的服务'
  )
  expect(
    within(anthropic).getByText('接入 Anthropic API 或兼容其接口的服务')
  ).toBeVisible()
})

test('deprecated and flexible integration badges preserve provider selection and expose the full explanation', async () => {
  const select = vi.fn()
  const user = userEvent.setup()
  const view = render(
    <ChannelProviderPicker disabled={false} onSelect={select} />
  )
  const custom = screen.getByRole('option', { name: 'Custom Built-in #8' })
  const advanced = screen.getByRole('option', {
    name: 'Advanced Custom Built-in #58',
  })
  expect(custom).toHaveAccessibleDescription(
    'Deprecated · Legacy full-URL integration; use Advanced Custom for new channels'
  )
  await user.click(within(custom).getByText('Deprecated'))
  expect(select).toHaveBeenNthCalledWith(1, { kind: 'builtin', type: 8 })

  const details =
    "New API's flexible channel lets you configure upstream addresses and authentication per endpoint, choose native forwarding or supported protocol conversions, and configure model listing and balance queries independently"
  expect(advanced).toHaveAccessibleDescription(
    `Flexible integration · ${details}`
  )
  expect(
    within(advanced).getByText(
      'Configure endpoint routing, authentication and protocol conversion for different upstream services'
    )
  ).toHaveAttribute('title', details)
  await user.click(within(advanced).getByText('Flexible integration'))
  expect(select).toHaveBeenNthCalledWith(2, { kind: 'builtin', type: 58 })

  view.rerender(<ChannelProviderPicker disabled onSelect={select} />)
  expect(advanced).toHaveAttribute('aria-disabled', 'true')
  await user.click(within(advanced).getByText('Flexible integration'))
  expect(select).toHaveBeenCalledTimes(2)
})

test('searching a known type number selects that type and an unknown positive number remains usable', async () => {
  const select = vi.fn()
  const user = userEvent.setup()
  render(<ChannelProviderPicker disabled={false} onSelect={select} />)
  const search = screen.getByRole('combobox')
  await user.type(search, '43')
  await user.keyboard('{ArrowDown}{Enter}')
  expect(select).toHaveBeenLastCalledWith({ kind: 'builtin', type: 43 })
  await user.clear(search)
  await user.type(search, '999')
  await user.click(screen.getByRole('tab', { name: 'Built-in' }))
  expect(screen.queryByRole('option')).not.toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Custom' }))
  await user.click(search)
  await user.keyboard('{ArrowDown}{Enter}')
  expect(select).toHaveBeenLastCalledWith({ kind: 'builtin', type: 999 })
})
