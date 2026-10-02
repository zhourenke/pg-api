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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJSONStorage } from 'zustand/middleware'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { ModelPriceInlineCell } from '../components/model-price-inline-cell'
import type { PricingModel } from '../types'

function pricingModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'example-model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
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

describe('inline price cell', () => {
  it('lists input, output and cache read on one line with a currency symbol each', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({ completion_ratio: 4, cache_ratio: 0.1 })}
        options={{ tokenUnit: 'M' }}
      />
    )

    expect(
      screen
        .getAllByText(/^(Input|Output|Cache Read)$/)
        .map((n) => n.textContent)
    ).toEqual(['Input', 'Output', 'Cache Read'])
    expect(screen.getByText('$2')).toBeVisible()
    expect(screen.getByText('$8')).toBeVisible()
    expect(screen.getByText('$0.2')).toBeVisible()
    // The toolbar owns the token unit, so no value repeats it.
    expect(screen.queryByText(/\/ 1[KM]/)).toBeNull()
    expect(screen.queryByText(/CNY|USD/)).toBeNull()
  })

  it('truncates a price line instead of wrapping it when the column is narrow', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({ completion_ratio: 4, cache_ratio: 0.1 })}
        options={{ tokenUnit: 'M' }}
      />
    )

    // A squeezed column must ellipsise each line; wrapping reflowed the prices
    // into four lines and made the column measure its own wrapped width.
    for (const label of screen.getAllByText(/^(Input|Output|Cache Read)$/)) {
      const line = label.parentElement?.parentElement

      expect(line).toHaveClass('truncate')
      expect(line?.className).not.toContain('flex-wrap')
    }
  })

  it('omits the cache read price when the model has no cache ratio', () => {
    render(<ModelPriceInlineCell model={pricingModel()} options={{}} />)

    expect(screen.queryByText('Cache Read')).toBeNull()
    expect(screen.getAllByText(/^\$/)).toHaveLength(2)
  })

  it('recomputes every value when the token unit changes', () => {
    const { rerender } = render(
      <ModelPriceInlineCell
        model={pricingModel({ completion_ratio: 4 })}
        options={{ tokenUnit: 'M' }}
      />
    )
    expect(screen.getByText('$8')).toBeVisible()

    rerender(
      <ModelPriceInlineCell
        model={pricingModel({ completion_ratio: 4 })}
        options={{ tokenUnit: 'K' }}
      />
    )
    expect(screen.getByText('$0.008')).toBeVisible()
    expect(screen.queryByText(/\/ 1[KM]/)).toBeNull()
  })

  it('shows a per-call price without a request suffix for pay-per-request models', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({ quota_type: 1, model_price: 0.015 })}
        options={{ tokenUnit: 'K' }}
      />
    )

    expect(screen.getByText('Per-call')).toBeVisible()
    expect(screen.getByText('$0.015')).toBeVisible()
    // The label already names what a call is billed for, so the value repeats
    // no unit of its own.
    expect(screen.queryByText('/ request')).toBeNull()
    expect(screen.queryByText('/ 1K')).toBeNull()
  })

  it('labels an image-billed expression as per image without an image suffix', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("image", fixed(0.04)) * image_count',
        })}
        options={{ tokenUnit: 'M' }}
      />
    )

    expect(screen.getByText('Per image')).toBeVisible()
    expect(screen.getByText('$0.04')).toBeVisible()
    expect(screen.queryByText('Per-call')).toBeNull()
  })

  it('states the token unit next to the last token price only when asked for', () => {
    const { rerender } = render(
      <ModelPriceInlineCell
        model={pricingModel({ completion_ratio: 4 })}
        options={{ tokenUnit: 'M' }}
        showTokenUnitCaption
      />
    )
    expect(screen.getByText('/ 1M')).toBeVisible()

    rerender(
      <ModelPriceInlineCell
        model={pricingModel({ quota_type: 1, model_price: 0.015 })}
        options={{ tokenUnit: 'M' }}
        showTokenUnitCaption
      />
    )
    expect(screen.queryByText('/ 1M')).toBeNull()
  })

  it('puts cache prices on their own line and ends that line with the unit', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({ cache_ratio: 0.1, completion_ratio: 4 })}
        options={{ tokenUnit: 'M' }}
        showTokenUnitCaption
      />
    )

    const input = screen.getByText('Input')
    const output = screen.getByText('Output')
    const cache = screen.getByText('Cache Read')

    // Input and output share the first line; the cache price starts a new line
    // that carries the unit, so the column does not grow with the cache field.
    expect(input.parentElement?.parentElement).toBe(
      output.parentElement?.parentElement
    )
    expect(cache.parentElement?.parentElement).not.toBe(
      input.parentElement?.parentElement
    )
    // The unit suffix closes that same line, right after the cache price.
    const cacheLine = cache.parentElement?.parentElement
    expect(cacheLine?.textContent).toMatch(/Cache Read.*\/ 1M$/)
    expect(cacheLine?.textContent?.match(/1M/g)).toHaveLength(1)
  })

  it('shows the tier prices of an expression model including its cache read price', () => {
    render(
      <ModelPriceInlineCell
        model={pricingModel({
          billing_mode: 'tiered_expr',
          billing_expr: 'tier("standard", p * 0.05 + c * 0.2 + cr * 0.001)',
        })}
        options={{ tokenUnit: 'M' }}
      />
    )

    expect(screen.getByText('$0.05')).toBeVisible()
    expect(screen.getByText('$0.2')).toBeVisible()
    expect(screen.getByText('Cache Read')).toBeVisible()
    expect(screen.getByText('$0.001')).toBeVisible()
    expect(screen.queryByText(/\/ 1[KM]/)).toBeNull()
  })
})
