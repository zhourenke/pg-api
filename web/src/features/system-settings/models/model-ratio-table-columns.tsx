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
import { Checkbox } from '@/components/ui/checkbox'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'

import { toPriceCellModel, type ModelRow } from './model-pricing-snapshots'
import { ModelIdentity } from './model-ratio-card'

type BuildModelRatioColumnsOptions = {
  onDelete: (name: string) => void
  deleteDisabled?: boolean
  /** 未设置价格模型：行内容本身可点击编辑，只需要认出模型的两列。 */
  identityOnly?: boolean
  t: (key: string) => string
}

export function buildModelRatioColumns({
  onDelete,
  deleteDisabled,
  identityOnly,
  t,
}: BuildModelRatioColumnsOptions): ColumnDef<ModelRow>[] {
  const columns: ColumnDef<ModelRow>[] = [
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
    },
    {
      id: 'name',
      accessorKey: 'name',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Model name')} />
      ),
      cell: ({ row }) => <ModelIdentity model={row.original} />,
      enableHiding: false,
      meta: { label: t('Model name') },
    },
    {
      id: 'priceSummary',
      header: ({ column }) => (
        <DataTableColumnHeader column={column} title={t('Price summary')} />
      ),
      // The same cell the model list uses, so both pages quote the base tier's
      // input, output and cache read price in the site currency per 1M tokens.
      cell: ({ row }) => (
        <ModelPriceCell model={toPriceCellModel(row.original)} />
      ),
      enableSorting: false,
      meta: { label: t('Price summary') },
    },
    {
      id: 'actions',
      header: () => <div>{t('Actions')}</div>,
      // 编辑不再是按钮：整行内容本身就可以点击编辑。
      cell: ({ row }) => (
        <StaticRowActions
          deleteLabel={t('Delete')}
          onDelete={() => onDelete(row.original.name)}
          deleteDisabled={deleteDisabled}
        />
      ),
      enableHiding: false,
    },
  ]

  return identityOnly
    ? columns.filter((column) => column.id === 'select' || column.id === 'name')
    : columns
}
