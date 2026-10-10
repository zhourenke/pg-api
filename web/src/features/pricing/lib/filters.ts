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
import {
  SORT_DIRECTIONS,
  SORT_PRICE_TYPES,
  type SortPriceType,
  FILTER_ALL,
  QUOTA_TYPES,
  ENDPOINT_TYPES,
} from '../constants'
import type { PricingModel, TokenUnit } from '../types'
import {
  classifyQuotaType,
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from './dynamic-price'
import { getRequestPriceValue, getTokenPriceValue } from './price'

// ----------------------------------------------------------------------------
// Filter Utilities
// ----------------------------------------------------------------------------

/**
 * Filter models by search query
 */
function filterBySearch(models: PricingModel[], query: string): PricingModel[] {
  if (!query) return models

  const lowerQuery = query.toLowerCase()
  return models.filter(
    (m) =>
      m.model_name?.toLowerCase().includes(lowerQuery) ||
      m.description?.toLowerCase().includes(lowerQuery) ||
      m.tags?.toLowerCase().includes(lowerQuery) ||
      m.vendor_name?.toLowerCase().includes(lowerQuery)
  )
}

/**
 * Filter models by vendor
 */
function filterByVendor(
  models: PricingModel[],
  vendor: string
): PricingModel[] {
  if (vendor === FILTER_ALL) return models
  return models.filter((m) => m.vendor_name === vendor)
}

/**
 * Filter models by group
 */
function filterByGroup(models: PricingModel[], group: string): PricingModel[] {
  if (group === FILTER_ALL) return models
  return models.filter((m) => m.enable_groups?.includes(group))
}

/**
 * Filter models by quota type
 *
 * The three buckets are mutually exclusive and follow `classifyQuotaType`, so a
 * model priced per call by an expression is 按次 here even though its
 * `quota_type` field says otherwise.
 */
export function filterByQuotaType(
  models: PricingModel[],
  quotaType: string
): PricingModel[] {
  if (quotaType === QUOTA_TYPES.ALL) return models
  return models.filter((model) => classifyQuotaType(model) === quotaType)
}

/**
 * Filter models by endpoint type
 */
function filterByEndpointType(
  models: PricingModel[],
  endpointType: string
): PricingModel[] {
  if (endpointType === ENDPOINT_TYPES.ALL) return models
  return models.filter((m) =>
    m.supported_endpoint_types?.includes(endpointType)
  )
}

export type SortModelsOptions = {
  sortBy: string
  sortDir?: string
  tokenUnit: TokenUnit
  showRechargePrice: boolean
  priceRate: number
  usdExchangeRate: number
  selectedGroup?: string
}

/** Dynamic entries that carry each sortable price */
const DYNAMIC_FIELDS_BY_PRICE_TYPE: Record<SortPriceType, string> = {
  input: 'inputPrice',
  output: 'outputPrice',
  cache: 'cacheReadPrice',
}

/**
 * Sort value for a price option, in the same unit and currency the price cells
 * show. Models that are billed per call or per image always participate, using
 * the number the price cell shows for them; a model whose cells show no price
 * for the requested field sorts after every model that has one.
 */
function getPriceSortValue(
  model: PricingModel,
  type: SortPriceType,
  options: SortModelsOptions
): number | null {
  const dynamic = getDynamicPricingSummary(model, {
    tokenUnit: options.tokenUnit,
    showRechargePrice: options.showRechargePrice,
    priceRate: options.priceRate,
    usdExchangeRate: options.usdExchangeRate,
    groupRatioMultiplier: getDynamicDisplayGroupRatio(
      model,
      options.selectedGroup
    ),
  })

  if (dynamic) {
    if (dynamic.isSpecialExpression) return null
    const exact = dynamic.entries.find(
      (item) => item.field === DYNAMIC_FIELDS_BY_PRICE_TYPE[type]
    )
    if (exact) return exact.value
    const perCall = dynamic.entries.find(
      (item) => item.unit === 'request' || item.unit === 'image'
    )
    return perCall ? perCall.value : null
  }

  const tokenPrice = getTokenPriceValue(
    model,
    type,
    options.tokenUnit,
    options.showRechargePrice,
    options.priceRate,
    options.usdExchangeRate,
    options.selectedGroup
  )
  if (tokenPrice !== null) return tokenPrice

  return getRequestPriceValue(
    model,
    options.showRechargePrice,
    options.priceRate,
    options.usdExchangeRate,
    options.selectedGroup
  )
}

function compareByName(a: PricingModel, b: PricingModel): number {
  return (a.model_name || '').localeCompare(b.model_name || '')
}

/**
 * Sort models by the selected field and direction.
 *
 * Price options compare the displayed price, so switching the token unit or the
 * recharge mode keeps the order consistent with the numbers on screen.
 */
export function sortModels(
  models: PricingModel[],
  options: SortModelsOptions
): PricingModel[] {
  const sorted = [...models]
  const priceType =
    SORT_PRICE_TYPES[options.sortBy as keyof typeof SORT_PRICE_TYPES]
  const descending = options.sortDir === SORT_DIRECTIONS.DESC

  if (!priceType) {
    sorted.sort((a, b) =>
      descending ? compareByName(b, a) : compareByName(a, b)
    )
    return sorted
  }

  sorted.sort((a, b) => {
    const valueA = getPriceSortValue(a, priceType, options)
    const valueB = getPriceSortValue(b, priceType, options)

    if (valueA === null && valueB === null) return compareByName(a, b)
    if (valueA === null) return 1
    if (valueB === null) return -1
    if (valueA === valueB) return compareByName(a, b)
    return descending ? valueB - valueA : valueA - valueB
  })

  return sorted
}

/**
 * Apply all filters and sorting to models
 */
export function filterAndSortModels(
  models: PricingModel[],
  filters: SortModelsOptions & {
    search: string
    vendor: string
    group: string
    quotaType: string
    endpointType: string
    tag: string
  }
): PricingModel[] {
  let result = filterBySearch(models, filters.search)
  result = filterByVendor(result, filters.vendor)
  result = filterByGroup(result, filters.group)
  result = filterByQuotaType(result, filters.quotaType)
  result = filterByEndpointType(result, filters.endpointType)
  result = filterByTag(result, filters.tag)
  result = sortModels(result, filters)

  return result
}

/**
 * Parse tags from comma-separated string
 */
export function parseTags(tagsString?: string): string[] {
  if (!tagsString) return []
  return tagsString
    .split(/[,;|\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/**
 * Extract all unique tags from models
 */
export function extractAllTags(models: PricingModel[]): string[] {
  const tagSet = new Set<string>()

  models.forEach((model) => {
    if (model.tags) {
      const tags = parseTags(model.tags)
      tags.forEach((tag) => {
        tagSet.add(tag.toLowerCase())
      })
    }
  })

  return [...tagSet].sort((a, b) => a.localeCompare(b))
}

/**
 * Filter models by tag
 */
function filterByTag(models: PricingModel[], tag: string): PricingModel[] {
  if (tag === FILTER_ALL) return models

  const tagLower = tag.toLowerCase()
  return models.filter((m) => {
    if (!m.tags) return false
    const modelTags = parseTags(m.tags).map((t) => t.toLowerCase())
    return modelTags.includes(tagLower)
  })
}
