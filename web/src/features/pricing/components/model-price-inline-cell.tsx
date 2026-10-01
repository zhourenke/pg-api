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
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useSystemConfigStore } from '@/stores/system-config-store'

import { DEFAULT_TOKEN_UNIT } from '../constants'
import { useBillingTime } from '../hooks/use-billing-time'
import {
  getDynamicDisplayGroupRatio,
  getDynamicPricingSummary,
} from '../lib/dynamic-price'
import { isTokenBasedModel } from '../lib/model-helpers'
import { formatPrice, formatRequestPrice } from '../lib/price'
import type { PricingModel, TokenUnit } from '../types'

/**
 * Single-line price summary that carries the currency symbol and unit on every
 * value, so a table row can show input, output and cache-read prices together.
 */
export type ModelPriceInlineCellOptions = {
  tokenUnit?: TokenUnit
  priceRate?: number
  usdExchangeRate?: number
  showRechargePrice?: boolean
  selectedGroup?: string
}

type PriceSegment = {
  key: string
  label: string
  value: string
  unit: string
}

type PriceSummary = {
  segments: PriceSegment[]
  /** True when the prices are denominated per token rather than per call. */
  perToken: boolean
}

const INLINE_CACHE_FIELDS = new Set(['cacheReadPrice', 'imageCachePrice'])

export function ModelPriceInlineCell(props: {
  model: PricingModel
  options?: ModelPriceInlineCellOptions
  /**
   * States the token unit under the prices. Surfaces without a unit switcher,
   * such as the model list, need it; the model square picks the unit itself.
   */
  showTokenUnitCaption?: boolean
}) {
  const { t } = useTranslation()
  const currency = useSystemConfigStore((state) => state.config.currency)
  const options = props.options ?? {}
  const tokenUnit = options.tokenUnit ?? DEFAULT_TOKEN_UNIT
  const billingTime = useBillingTime(props.model.billing_expr)
  const dynamic = useMemo(
    () =>
      getDynamicPricingSummary(props.model, {
        priceRate: options.priceRate,
        usdExchangeRate: options.usdExchangeRate,
        showRechargePrice: options.showRechargePrice,
        now: billingTime === undefined ? undefined : new Date(billingTime),
        tokenUnit,
        showCurrencySymbol: true,
        groupRatioMultiplier: getDynamicDisplayGroupRatio(
          props.model,
          options.selectedGroup
        ),
      }),
    // Currency is read indirectly by the price formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.model,
      tokenUnit,
      options.priceRate,
      options.usdExchangeRate,
      options.showRechargePrice,
      options.selectedGroup,
      billingTime,
      currency,
    ]
  )

  const summary = useMemo<PriceSummary>(() => {
    if (dynamic) {
      if (dynamic.isSpecialExpression) {
        return {
          segments: [
            {
              key: 'expression',
              label: t('Special billing expression'),
              value: '',
              unit: '',
            },
          ],
          perToken: false,
        }
      }

      const requestEntry = dynamic.entries.find(
        (entry) => entry.unit === 'request' || entry.unit === 'image'
      )
      if (requestEntry) {
        const price = requestEntry.formattedRange ?? requestEntry.formatted
        return {
          segments: [
            {
              key: requestEntry.key,
              // The label names the billed unit, so the value needs no suffix.
              label: t(
                requestEntry.unit === 'image' ? 'Per image' : 'Per-call'
              ),
              value: price,
              unit: '',
            },
          ],
          perToken: false,
        }
      }

      const cacheEntry = dynamic.entries.find((entry) =>
        INLINE_CACHE_FIELDS.has(entry.field)
      )
      const priced = cacheEntry
        ? [...dynamic.primaryEntries, cacheEntry]
        : dynamic.primaryEntries
      if (priced.length === 0) {
        return {
          segments: [
            {
              key: 'dynamic',
              label: t('Dynamic Pricing'),
              value: '',
              unit: '',
            },
          ],
          perToken: false,
        }
      }

      // The toolbar picks the token unit, so token prices carry no suffix.
      return {
        segments: priced.map((entry) => ({
          key: entry.key,
          label: t(entry.shortLabel),
          value: entry.formattedRange ?? entry.formatted,
          unit: '',
        })),
        perToken: true,
      }
    }

    if (isTokenBasedModel(props.model)) {
      const prices: PriceSegment[] = [
        {
          key: 'input',
          label: t('Input'),
          value: formatPrice(
            props.model,
            'input',
            tokenUnit,
            options.showRechargePrice,
            options.priceRate,
            options.usdExchangeRate,
            options.selectedGroup,
            true
          ),
          unit: '',
        },
        {
          key: 'output',
          label: t('Output'),
          value: formatPrice(
            props.model,
            'output',
            tokenUnit,
            options.showRechargePrice,
            options.priceRate,
            options.usdExchangeRate,
            options.selectedGroup,
            true
          ),
          unit: '',
        },
      ]
      if (props.model.cache_ratio != null) {
        prices.push({
          key: 'cache',
          label: t('Cache Read'),
          value: formatPrice(
            props.model,
            'cache',
            tokenUnit,
            options.showRechargePrice,
            options.priceRate,
            options.usdExchangeRate,
            options.selectedGroup,
            true
          ),
          unit: '',
        })
      }
      return { segments: prices, perToken: true }
    }

    if (!Number.isFinite(props.model.model_price)) {
      return {
        segments: [
          { key: 'unset', label: t('Unset price'), value: '', unit: '' },
        ],
        perToken: false,
      }
    }

    return {
      segments: [
        {
          key: 'request',
          label: t('Per-call'),
          value: formatRequestPrice(
            props.model,
            options.showRechargePrice,
            options.priceRate,
            options.usdExchangeRate,
            options.selectedGroup,
            true
          ),
          unit: '',
        },
      ],
      perToken: false,
    }
    // Currency is read indirectly by the price formatter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dynamic,
    props.model,
    tokenUnit,
    options.showRechargePrice,
    options.priceRate,
    options.usdExchangeRate,
    options.selectedGroup,
    t,
    currency,
  ])

  return (
    <span className='block min-w-0'>
      <span className='flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-sm'>
        {summary.segments.map((segment) => (
          <span
            key={segment.key}
            className='flex items-baseline gap-1 whitespace-nowrap'
          >
            <span className='text-muted-foreground text-xs'>
              {segment.label}
            </span>
            {segment.value && (
              <span className='font-mono tabular-nums'>{segment.value}</span>
            )}
            {segment.unit && (
              <span className='text-muted-foreground text-xs'>
                / {segment.unit}
              </span>
            )}
          </span>
        ))}
      </span>
      {summary.perToken && props.showTokenUnitCaption && (
        <span className='text-muted-foreground mt-1 block text-xs font-normal break-words whitespace-normal'>
          {t('/ {{unit}} Tokens', { unit: `1${tokenUnit}` })}
        </span>
      )}
    </span>
  )
}
