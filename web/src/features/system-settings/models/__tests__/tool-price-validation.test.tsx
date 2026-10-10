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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { beforeAll, describe, expect, test } from 'vitest'

import { ToolPriceSettings } from '../tool-price-settings'

const BILLABLE_TOOL_IDENTIFIERS = [
  'web_search_preview',
  'web_search',
  'file_search',
  'google_search',
  'image_generation',
]

function renderToolPriceSettings(defaultValue: string) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })

  render(
    <QueryClientProvider client={queryClient}>
      <ToolPriceSettings defaultValue={defaultValue} />
    </QueryClientProvider>
  )

  return queryClient
}

describe('tool price validation', () => {
  beforeAll(() => {
    i18next.addResourceBundle('zhCN', 'translation', {
      'Price ($/1K calls)': 'Price ($/1K calls)',
      'Please enter a valid number': 'Please enter a valid number',
      'Tool identifier': 'Tool identifier',
    })
  })

  test('blocks an empty price without converting it to an explicit zero', () => {
    const queryClient = renderToolPriceSettings('{"web_search":10}')

    const priceInput = screen.getByRole('spinbutton', {
      name: 'Price ($/1K calls): web_search',
    })
    const saveButton = screen.getByRole('button', { name: 'Save tool prices' })

    fireEvent.change(priceInput, { target: { value: '' } })

    expect(priceInput).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Please enter a valid number')).toBeInTheDocument()
    expect(saveButton).toBeDisabled()

    fireEvent.change(priceInput, { target: { value: '0' } })

    expect(priceInput).toHaveAttribute('aria-invalid', 'false')
    expect(saveButton).toBeEnabled()

    fireEvent.change(priceInput, { target: { value: '0.04' } })

    expect(priceInput).toHaveValue(0.04)
    expect(priceInput).toBeValid()
    expect(saveButton).toBeEnabled()

    fireEvent.change(priceInput, { target: { value: '0.0001' } })
    expect(priceInput).toBeValid()

    fireEvent.change(priceInput, { target: { value: '0.00001' } })
    expect((priceInput as HTMLInputElement).validity.stepMismatch).toBe(true)

    fireEvent.change(priceInput, { target: { value: '-0.04' } })

    expect(priceInput).toHaveAttribute('aria-invalid', 'true')
    expect(saveButton).toBeDisabled()

    queryClient.clear()
  })

  test('does not dress the empty tool identifier up as a default value', () => {
    const queryClient = renderToolPriceSettings('{"web_search":10}')

    const toolInput = screen.getByRole('textbox', {
      name: 'Tool identifier',
    })

    expect(toolInput).toHaveValue('web_search')
    expect(toolInput).not.toHaveAttribute('placeholder')

    queryClient.clear()
  })

  test('names every built-in tool identifier the request gate can demand', () => {
    const queryClient = renderToolPriceSettings('{}')

    const hint = screen.getByRole('alert')

    expect(
      within(hint)
        .getAllByRole('listitem')
        .map((item) => item.textContent)
    ).toEqual(BILLABLE_TOOL_IDENTIFIERS)

    queryClient.clear()
  })

  test('warns that an unpriced built-in tool is refused and that chat web search needs the web_search_preview price', () => {
    const queryClient = renderToolPriceSettings('{}')

    const hint = screen.getByRole('alert')

    expect(hint).toHaveTextContent('503')
    expect(hint).toHaveTextContent('web_search_options')
    expect(hint).toHaveTextContent('web_search_preview')

    queryClient.clear()
  })
})
