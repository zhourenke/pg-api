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
import { render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { PricingTable } from '../components/pricing-table'
import type { PricingModel } from '../types'

function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    vendor_name: 'Example Vendor',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 4,
    enable_groups: ['default'],
    supported_endpoint_types: ['openai'],
    ...overrides,
  }
}

const originalStorage = useSystemConfigStore.persist.getOptions().storage

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  })
  useSystemConfigStore.persist.setOptions({
    storage: createJSONStorage(() => localStorage),
  })
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
})

afterEach(() => {
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  vi.unstubAllGlobals()
  useSystemConfigStore.persist.setOptions({ storage: originalStorage })
})

describe('pricing table', () => {
  it('renders the model, vendor, tags, price, groups and endpoints columns in order', () => {
    render(<PricingTable models={[pricingModel()]} tokenUnit='M' />)

    expect(
      screen.getAllByRole('columnheader').map((header) => header.textContent)
    ).toEqual(['Model', 'Vendor', 'Tags', 'Price', 'Groups', 'Endpoints'])
  })

  it('reserves the widest column for the price summary', () => {
    const { container } = render(
      <PricingTable models={[pricingModel()]} tokenUnit='M' />
    )

    const widths = Array.from(
      container.querySelectorAll('colgroup col'),
      (col) => Number.parseFloat((col as HTMLElement).style.width)
    )
    expect(widths).toHaveLength(6)
    // The price cell renders input, output and cache read on one line, so it
    // takes the largest share of the table width.
    expect(widths[3]).toBe(Math.max(...widths))
    expect(widths[3]).toBeGreaterThanOrEqual(35)
  })

  it('leaves the model header without its own sort control', () => {
    render(<PricingTable models={[pricingModel()]} tokenUnit='M' />)

    const modelHeader = screen.getByRole('columnheader', { name: 'Model' })
    expect(within(modelHeader).queryByRole('button')).toBeNull()
  })

  it('re-renders visible price cells when the token unit changes', () => {
    const { rerender } = render(
      <PricingTable models={[pricingModel()]} tokenUnit='M' />
    )
    expect(screen.getByText('$2')).toBeVisible()
    expect(screen.getByText('$8')).toBeVisible()

    rerender(<PricingTable models={[pricingModel()]} tokenUnit='K' />)
    expect(screen.getByText('$0.002')).toBeVisible()
    expect(screen.getByText('$0.008')).toBeVisible()
    expect(screen.queryByText('$2')).toBeNull()
    expect(screen.getAllByText('/ 1K')).toHaveLength(2)
  })

  it('re-renders visible price cells when the recharge display mode changes', () => {
    const props = {
      models: [pricingModel()],
      tokenUnit: 'M' as const,
      priceRate: 3,
      usdExchangeRate: 6,
    }
    const { rerender } = render(<PricingTable {...props} />)
    expect(screen.getByText('$2')).toBeVisible()

    rerender(<PricingTable {...props} showRechargePrice />)
    expect(screen.getByText('$1')).toBeVisible()
    expect(screen.queryByText('$2')).toBeNull()
  })
})
