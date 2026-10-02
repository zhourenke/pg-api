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

import { DataTableColumnHeader } from '@/components/data-table/core/column-header'
import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { StatusBadge } from '@/components/status-badge'
import { Checkbox } from '@/components/ui/checkbox'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'

import type { ModelRow } from './model-pricing-snapshots'

const asNumber = (value?: string) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

type BuildModelRatioColumnsOptions = {
  onDelete: (name: string) => void
  onEdit: (model: ModelRow) => void
  deleteDisabled?: boolean
  t: (key: string) => string
}

export function buildModelRatioColumns({
  onDelete,
  onEdit,
  deleteDisabled,
  t,
}: BuildModelRatioColumnsOptions): ColumnDef<ModelRow>[] {
  return [
    {
      id: 'select',
      header: ({ table }) => (
        <Checkbox
          checked={table.getIsAllPageRowsSelected()}
          indeterminate={table.getIsSomePageRowsSelected()}
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label={t('Select all')}
          className='translate-y-[2px]'
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label={t('Select row')}
          className='translate-y-[2px]'
        />
      ),
      enableSorting: false,
      enableHiding: false,
      size: 40,
    },
    {
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Model name')} />
      ),
      cell: ({ row }) => (
        <div className='flex min-w-0 items-center gap-2 font-medium'>
          <span className='min-w-0 truncate'>{row.getValue('name')}</span>
          {row.original.hasConflict && (
            <StatusBadge
              label={t('Conflict')}
              variant='danger'
              copyable={false}
              className='shrink-0'
            />
          )}
        </div>
      ),
      enableHiding: false,
      size: 260,
      minSize: 200,
      meta: { label: t('Model name') },
    },
    {
      id: 'priceSummary',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Price summary')} />
      ),
      // The same cell the model list uses, so both pages quote the base tier's
      // input, output and cache read price in the site currency per 1M tokens.
      cell: ({ row }) => {
        const model = row.original

        return (
          <ModelPriceCell
            model={{
              id: 0,
              model_name: model.name,
              quota_type: model.billingMode === 'per-request' ? 1 : 0,
              model_ratio: asNumber(model.ratio),
              completion_ratio: asNumber(model.completionRatio),
              cache_ratio: model.cacheRatio ? asNumber(model.cacheRatio) : null,
              create_cache_ratio: model.createCacheRatio
                ? asNumber(model.createCacheRatio)
                : null,
              model_price: model.price ? asNumber(model.price) : undefined,
              billing_mode: model.billingMode,
              billing_expr: model.billingExpr,
              enable_groups: [],
            }}
          />
        )
      },
      enableSorting: false,
      size: 360,
      minSize: 240,
      meta: { label: t('Price summary') },
    },
    {
      id: 'actions',
      header: () => <div>{t('Actions')}</div>,
      cell: ({ row }) => (
        <StaticRowActions
          editLabel={t('Edit')}
          deleteLabel={t('Delete')}
          onEdit={() => onEdit(row.original)}
          onDelete={() => onDelete(row.original.name)}
          deleteDisabled={deleteDisabled}
        />
      ),
      enableHiding: false,
    },
  ]
}
