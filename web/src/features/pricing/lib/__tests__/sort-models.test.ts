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
import { describe, expect, it } from 'vitest'

import type { PricingModel, TokenUnit } from '../../types'
import { sortModels, type SortModelsOptions } from '../filters'

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

function options(
  sortBy: string,
  overrides: Partial<SortModelsOptions> = {}
): SortModelsOptions {
  return {
    sortBy,
    tokenUnit: 'M' as TokenUnit,
    showRechargePrice: false,
    priceRate: 1,
    usdExchangeRate: 1,
    ...overrides,
  }
}

function names(models: PricingModel[]): string[] {
  return models.map((model) => model.model_name)
}

const cheap = pricingModel({ id: 1, model_name: 'cheap', model_ratio: 1 })
const pricey = pricingModel({ id: 2, model_name: 'pricey', model_ratio: 3 })
const perCall = pricingModel({
  id: 3,
  model_name: 'per-call',
  quota_type: 1,
  model_price: 0.01,
})

describe('pricing sort', () => {
  it('sorts by model name in both directions', () => {
    expect(names(sortModels([pricey, cheap], options('name')))).toEqual([
      'cheap',
      'pricey',
    ])
    expect(
      names(sortModels([cheap, pricey], options('name', { sortDir: 'desc' })))
    ).toEqual(['pricey', 'cheap'])
  })

  it('sorts by the selected price field in both directions', () => {
    expect(names(sortModels([pricey, cheap], options('input-price')))).toEqual([
      'cheap',
      'pricey',
    ])
    expect(
      names(
        sortModels([cheap, pricey], options('input-price', { sortDir: 'desc' }))
      )
    ).toEqual(['pricey', 'cheap'])
  })

  it('sorts by cache read price and keeps models without one last', () => {
    const withCache = pricingModel({
      id: 1,
      model_name: 'with-cache',
      model_ratio: 1,
      cache_ratio: 0.1,
    })
    const withoutCache = pricingModel({
      id: 2,
      model_name: 'without-cache',
      model_ratio: 3,
    })

    expect(
      names(sortModels([withoutCache, withCache], options('cache-read-price')))
    ).toEqual(['with-cache', 'without-cache'])
    expect(
      names(
        sortModels(
          [withCache, withoutCache],
          options('cache-read-price', { sortDir: 'desc' })
        )
      )
    ).toEqual(['with-cache', 'without-cache'])
  })

  it('sorts per-call models together with token models by the displayed number', () => {
    expect(names(sortModels([cheap, perCall], options('input-price')))).toEqual(
      ['per-call', 'cheap']
    )
    expect(
      names(sortModels([cheap, perCall], options('cache-read-price')))
    ).toEqual(['per-call', 'cheap'])
  })

  it('reorders when the displayed token unit changes the numbers', () => {
    // 0.01 USD per call stays as is, while the token price shrinks by 1000.
    expect(names(sortModels([perCall, cheap], options('input-price')))).toEqual(
      ['per-call', 'cheap']
    )
    expect(
      names(
        sortModels(
          [perCall, cheap],
          options('input-price', { tokenUnit: 'K' as TokenUnit })
        )
      )
    ).toEqual(['cheap', 'per-call'])
  })

  it('falls back to the model name when two prices are equal', () => {
    const alpha = pricingModel({ id: 1, model_name: 'alpha', model_ratio: 2 })
    const beta = pricingModel({ id: 2, model_name: 'beta', model_ratio: 2 })

    expect(names(sortModels([beta, alpha], options('output-price')))).toEqual([
      'alpha',
      'beta',
    ])
  })

  it('keeps models without the requested price last for every direction', () => {
    const inputOnly = pricingModel({
      id: 1,
      model_name: 'input-only',
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("standard", p * 0.05 + c * 0.2)',
    })
    const withCache = pricingModel({
      id: 2,
      model_name: 'with-cache',
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("standard", p * 0.05 + c * 0.2 + cr * 0.001)',
    })

    expect(
      names(sortModels([inputOnly, withCache], options('cache-read-price')))
    ).toEqual(['with-cache', 'input-only'])
    expect(
      names(
        sortModels(
          [withCache, inputOnly],
          options('cache-read-price', { sortDir: 'desc' })
        )
      )
    ).toEqual(['with-cache', 'input-only'])
  })
})
