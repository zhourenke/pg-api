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
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { AxiosAdapter } from 'axios'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { api } from '@/lib/http-client'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ToolPriceSettings } from '../tool-price-settings'

const originalAdapter = api.defaults.adapter
const clients: QueryClient[] = []

/** Record every option update so a case can assert what is actually stored. */
function captureOptionUpdates() {
  const bodies: unknown[] = []
  const adapter: AxiosAdapter = async (config) => {
    bodies.push(
      typeof config.data === 'string' ? JSON.parse(config.data) : config.data
    )
    return {
      data: { success: true, message: '' },
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    }
  }
  api.defaults.adapter = adapter
  return bodies
}

function setSiteCurrency(
  quotaDisplayType: 'USD' | 'CNY' | 'CUSTOM' | 'TOKENS',
  usdExchangeRate: number
) {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType, usdExchangeRate },
  })
}

function renderToolPriceSettings(defaultValue: string) {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  clients.push(queryClient)

  render(
    <QueryClientProvider client={queryClient}>
      <ToolPriceSettings defaultValue={defaultValue} />
    </QueryClientProvider>
  )
}

function priceInput(label = 'Price (¥/1K calls): web_search') {
  return screen.getByRole('textbox', { name: label })
}

async function selectCurrency(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Pricing currency' }))
  await user.click(await screen.findByRole('option', { name: label }))
}

beforeEach(() => {
  localStorage.clear()
  setSiteCurrency('USD', 1)
})

afterEach(() => {
  api.defaults.adapter = originalAdapter
  clients.splice(0).forEach((client) => client.clear())
  setSiteCurrency('USD', 1)
  localStorage.clear()
})

describe('tool price currency', () => {
  // Runs first on purpose: it observes the remembered preference's own default,
  // so it must not touch the store beforehand.
  test('defaults to the site currency and previews the stored USD price in it', () => {
    setSiteCurrency('CNY', 7.3)
    renderToolPriceSettings('{"web_search":5}')

    expect(
      screen.getByRole('columnheader', { name: 'Price (¥/1K calls)' })
    ).toBeInTheDocument()
    expect(priceInput()).toHaveValue('36.5')
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Prices are saved and billed in USD'
    )
  })

  test('stores the USD value behind an amount typed in the site currency', async () => {
    setSiteCurrency('CNY', 7.3)
    usePricingPreferencesStore.setState({ currency: 'site' })
    const bodies = captureOptionUpdates()
    renderToolPriceSettings('{"web_search":5}')

    fireEvent.change(priceInput(), { target: { value: '73' } })
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Save tool prices' }))

    expect(bodies).toEqual([
      { key: 'tool_price_setting.prices', value: '{"web_search":10}' },
    ])
  })

  test('honours an explicit USD choice and keeps the stored price through a switch', async () => {
    setSiteCurrency('CNY', 7.3)
    usePricingPreferencesStore.setState({ currency: 'site' })
    const bodies = captureOptionUpdates()
    renderToolPriceSettings('{"web_search":5}')

    expect(priceInput()).toHaveValue('36.5')

    await selectCurrency('US dollar (USD)')

    expect(priceInput('Price ($/1K calls): web_search')).toHaveValue('5')
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Save tool prices' }))

    expect(bodies).toEqual([
      { key: 'tool_price_setting.prices', value: '{"web_search":5}' },
    ])
  })

  test('falls back to USD without the conversion note when the rate is unusable', () => {
    setSiteCurrency('CNY', 0)
    usePricingPreferencesStore.setState({ currency: 'site' })
    renderToolPriceSettings('{"web_search":5}')

    expect(priceInput('Price ($/1K calls): web_search')).toHaveValue('5')
    expect(screen.getByRole('alert')).not.toHaveTextContent(
      'Prices are saved and billed in USD'
    )
  })
})
