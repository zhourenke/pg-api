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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { BadgeCell, BadgeListCell } from '@/components/data-table'
import { GroupBadge } from '@/components/group-badge'
import { StatusBadge } from '@/components/status-badge'
import { getLobeIcon } from '@/lib/lobe-icon'

import { parseTags } from '../lib/filters'
import type { PricingModel } from '../types'
import {
  ModelPriceInlineCell,
  type ModelPriceInlineCellOptions,
} from './model-price-inline-cell'

// ----------------------------------------------------------------------------
// Pricing Table Columns
// ----------------------------------------------------------------------------

export type PricingColumnsOptions = ModelPriceInlineCellOptions

export function usePricingColumns(
  options: PricingColumnsOptions = {}
): ColumnDef<PricingModel>[] {
  const { t } = useTranslation()
  const {
    tokenUnit,
    priceRate,
    usdExchangeRate,
    showRechargePrice,
    selectedGroup,
  } = options

  return useMemo<ColumnDef<PricingModel>[]>(
    () => [
      // Model column
      {
        accessorKey: 'model_name',
        meta: { label: t('Model') },
        header: t('Model'),
        cell: ({ row }) => {
          const model = row.original
          const modelIconKey = model.icon || model.vendor_icon
          const modelIcon = modelIconKey ? getLobeIcon(modelIconKey, 14) : null

          return (
            <div className='flex max-w-full min-w-0 items-center gap-2'>
              {modelIcon}
              <span className='truncate font-mono text-sm font-medium'>
                {model.model_name}
              </span>
            </div>
          )
        },
        minSize: 170,
        size: 190,
        enableSorting: false,
      },

      // Vendor column
      {
        accessorKey: 'vendor_name',
        header: t('Vendor'),
        cell: ({ row }) => {
          const model = row.original
          if (!model.vendor_name) {
            return <span className='text-muted-foreground/50 text-xs'>—</span>
          }
          const vendorIcon = model.vendor_icon
            ? getLobeIcon(model.vendor_icon, 12)
            : null
          return (
            <BadgeCell className='gap-1.5'>
              {vendorIcon}
              <StatusBadge
                label={model.vendor_name}
                autoColor={model.vendor_name}
                size='sm'
                copyable={false}
              />
            </BadgeCell>
          )
        },
        size: 140,
        enableSorting: false,
      },

      // Tags column
      {
        accessorKey: 'tags',
        header: t('Tags'),
        cell: ({ row }) => {
          const tags = parseTags(row.original.tags)
          return (
            <BadgeListCell
              items={tags.map((tag) => (
                <StatusBadge
                  key={tag}
                  label={tag}
                  autoColor={tag}
                  size='sm'
                  copyable={false}
                />
              ))}
            />
          )
        },
        size: 140,
        enableSorting: false,
      },

      // Price column: input, output and cache read on one line
      {
        accessorKey: 'price',
        meta: { label: t('Price') },
        header: t('Price'),
        cell: ({ row }) => (
          <ModelPriceInlineCell
            model={row.original}
            options={{
              tokenUnit,
              priceRate,
              usdExchangeRate,
              showRechargePrice,
              selectedGroup,
            }}
          />
        ),
        size: 380,
        minSize: 280,
        enableSorting: false,
      },

      // Enable Groups column
      {
        accessorKey: 'enable_groups',
        header: t('Groups'),
        cell: ({ row }) => {
          const groups = row.original.enable_groups || []
          return (
            <BadgeListCell
              items={groups.map((group) => (
                <GroupBadge key={group} group={group} size='sm' />
              ))}
              tooltipClassName='max-w-[280px] p-2'
            />
          )
        },
        size: 110,
        enableSorting: false,
      },

      // Endpoints column
      {
        accessorKey: 'supported_endpoint_types',
        header: t('Endpoints'),
        cell: ({ row }) => {
          const endpoints = row.original.supported_endpoint_types || []
          return (
            <BadgeListCell
              items={endpoints.map((ep) => (
                <StatusBadge
                  key={ep}
                  label={ep}
                  autoColor={ep}
                  size='sm'
                  copyable={false}
                />
              ))}
            />
          )
        },
        size: 250,
        enableSorting: false,
      },
    ],
    [t, tokenUnit, priceRate, usdExchangeRate, showRechargePrice, selectedGroup]
  )
}
