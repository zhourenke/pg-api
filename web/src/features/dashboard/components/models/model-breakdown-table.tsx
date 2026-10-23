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
import type { ColumnDef, PaginationState } from '@tanstack/react-table'
import { Search, TableProperties, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTableFitColumnsButton,
  DataTablePage,
  DataTablePagination,
  DataTableRow,
  DataTableSortMenu,
  DataTableViewOptions,
  useDataTable,
  type DataTableSortDirection,
  type DataTableSortOption,
} from '@/components/data-table'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import {
  formatSharePercent,
  safeDivide,
  sharePercent,
  sortRowsBy,
} from '@/features/dashboard/lib'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { ModelBadge } from '@/features/usage-logs/components/model-badge'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { cn } from '@/lib/utils'

interface ModelBreakdownItem {
  model: string
  count: number
  quota: number
  tokens: number
  avgCostPerCall: number
  avgTokensPerCall: number
  quotaShare: number
  countShare: number
  tokensShare: number
}

type ModelSortKey =
  | 'model'
  | 'quota'
  | 'count'
  | 'tokens'
  | 'avgCostPerCall'
  | 'avgTokensPerCall'

interface ModelBreakdownTableProps {
  data: QuotaDataItem[]
  loading?: boolean
}

const PAGE_SIZE = 10

export function ModelBreakdownTable(props: ModelBreakdownTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [searchTerm, setSearchTerm] = useState('')
  const [sortKey, setSortKey] = useState<ModelSortKey>('quota')
  const [sortDirection, setSortDirection] =
    useState<DataTableSortDirection>('desc')
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })

  const items = useMemo(() => {
    const modelMap = new Map<
      string,
      { count: number; quota: number; tokens: number }
    >()

    let sumQuota = 0
    let sumCount = 0
    let sumTokens = 0

    for (const row of props.data) {
      const model = row.model_name || 'Unknown'
      const quota = Number(row.quota) || 0
      const count = Number(row.count) || 0
      const tokens = Number(row.token_used) || 0

      sumQuota += quota
      sumCount += count
      sumTokens += tokens

      const current = modelMap.get(model) || {
        count: 0,
        quota: 0,
        tokens: 0,
      }
      modelMap.set(model, {
        count: current.count + count,
        quota: current.quota + quota,
        tokens: current.tokens + tokens,
      })
    }

    const aggregated: ModelBreakdownItem[] = []

    for (const [model, stats] of modelMap.entries()) {
      aggregated.push({
        model,
        count: stats.count,
        quota: stats.quota,
        tokens: stats.tokens,
        avgCostPerCall: safeDivide(stats.quota, stats.count),
        avgTokensPerCall: safeDivide(stats.tokens, stats.count),
        quotaShare: sharePercent(stats.quota, sumQuota),
        countShare: sharePercent(stats.count, sumCount),
        tokensShare: sharePercent(stats.tokens, sumTokens),
      })
    }

    return aggregated
  }, [props.data])

  const filteredItems = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase()
    if (!trimmed) return items
    return items.filter((item) => item.model.toLowerCase().includes(trimmed))
  }, [items, searchTerm])

  const rows = useMemo(
    () => sortRowsBy(filteredItems, sortKey, sortDirection),
    [filteredItems, sortDirection, sortKey]
  )

  const sortOptions: DataTableSortOption<ModelSortKey>[] = useMemo(
    () => [
      { value: 'model', label: t('Model') },
      { value: 'quota', label: t('Quota') },
      { value: 'count', label: t('Requests') },
      { value: 'tokens', label: t('Token Count') },
      { value: 'avgCostPerCall', label: t('Avg Quota') },
      { value: 'avgTokensPerCall', label: t('Avg Tokens Count') },
    ],
    [t]
  )

  // The model square sorts its rows itself and leaves every column header as
  // plain text, so the table owns no sorting state at all here either: the
  // toolbar names the field, this card orders the rows, and the header only
  // labels them.
  const columns = useMemo<ColumnDef<ModelBreakdownItem>[]>(
    () => [
      {
        accessorKey: 'model',
        header: t('Model'),
        enableSorting: false,
        meta: { mobileTitle: true },
        cell: ({ row }) => <ModelBadge modelName={row.original.model} />,
      },
      {
        accessorKey: 'quota',
        header: t('Quota'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className='flex w-max max-w-full min-w-0 flex-col gap-0.5'>
            <span className='text-foreground min-w-0 truncate font-mono font-semibold tabular-nums'>
              {formatQuota(row.original.quota)}
            </span>
            <span
              className='text-muted-foreground/60 min-w-0 truncate tabular-nums'
              data-table-text='secondary'
            >
              {formatSharePercent(row.original.quotaShare)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'count',
        header: t('Requests'),
        enableSorting: false,
        cell: ({ row }) => (
          <div className='flex w-max max-w-full min-w-0 flex-col gap-0.5'>
            <span className='text-foreground min-w-0 truncate font-mono tabular-nums'>
              {formatNumber(row.original.count, locale)}
            </span>
            <span
              className='text-muted-foreground/60 min-w-0 truncate tabular-nums'
              data-table-text='secondary'
            >
              {formatSharePercent(row.original.countShare)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'tokens',
        header: t('Token Count'),
        enableSorting: false,
        cell: ({ row }) => (
          <div
            className='flex w-max max-w-full min-w-0 flex-col gap-0.5'
            title={formatNumber(row.original.tokens, locale)}
          >
            <span className='text-foreground min-w-0 truncate font-mono tabular-nums'>
              {formatTokens(row.original.tokens, '0')}
            </span>
            <span
              className='text-muted-foreground/60 min-w-0 truncate tabular-nums'
              data-table-text='secondary'
            >
              {formatSharePercent(row.original.tokensShare)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'avgCostPerCall',
        header: t('Avg Quota'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='text-muted-foreground min-w-0 truncate font-mono tabular-nums'>
            {row.original.avgCostPerCall > 0
              ? formatQuota(row.original.avgCostPerCall)
              : '--'}
          </span>
        ),
      },
      {
        accessorKey: 'avgTokensPerCall',
        header: t('Avg Tokens Count'),
        enableSorting: false,
        cell: ({ row }) => (
          <span className='text-muted-foreground min-w-0 truncate font-mono tabular-nums'>
            {row.original.avgTokensPerCall > 0
              ? formatTokens(Math.round(row.original.avgTokensPerCall), '0')
              : '--'}
          </span>
        ),
      },
    ],
    [t, locale]
  )

  const { table } = useDataTable({
    data: rows,
    columns,
    pagination,
    onPaginationChange: setPagination,
    enableRowSelection: false,
    withSortedRowModel: false,
  })

  const handleSearchChange = (value: string) => {
    setSearchTerm(value)
    setPagination((prev) => ({ ...prev, pageIndex: 0 }))
  }

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      {/* Card header: title, search, and the same sort / fit / view controls the
          usage logs toolbar carries. */}
      <div className='flex flex-col gap-2.5 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-2' size='sm'>
            <TableProperties />
          </IconBadge>
          <h3 className='text-sm font-semibold'>{t('Model Usage Details')}</h3>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative w-full sm:w-56'>
            <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              type='text'
              placeholder={t('Search models...')}
              value={searchTerm}
              onChange={(e) => handleSearchChange(e.target.value)}
              className='h-8 pr-7 pl-8 text-xs'
            />
            {searchTerm && (
              <button
                type='button'
                onClick={() => handleSearchChange('')}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-xs p-0.5'
                aria-label={t('Reset')}
              >
                <X className='size-3' />
              </button>
            )}
          </div>

          <DataTableSortMenu
            options={sortOptions}
            value={sortKey}
            onValueChange={(value) => {
              setSortKey(value)
              setPagination((prev) => ({ ...prev, pageIndex: 0 }))
            }}
            direction={sortDirection}
            onDirectionChange={(direction) => {
              setSortDirection(direction)
              setPagination((prev) => ({ ...prev, pageIndex: 0 }))
            }}
          />

          <DataTableFitColumnsButton table={table} />
          <DataTableViewOptions table={table} />
        </div>
      </div>

      <DataTablePage
        table={table}
        columns={columns}
        isLoading={props.loading}
        emptyTitle={t('No matching models')}
        emptyDescription={
          items.length === 0 ? t('No data available') : undefined
        }
        skeletonKeyPrefix='dashboard-model-breakdown-skeleton'
        showPagination={false}
        fixedHeight={false}
        toolbarProps={null}
        // Same chrome as the usage logs table: the shared header tint, and the
        // card already draws the frame, so the table container drops its own
        // border instead of nesting two of them.
        tableHeaderClassName='[background-color:var(--table-header)]'
        tableClassName={cn(
          'rounded-none border-0',
          '[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_td_*]:text-[13px] [&_[data-slot=table]_th]:text-[13px] [&_[data-slot=table]_th_*]:text-[13px]'
        )}
        renderRow={(row) => (
          <DataTableRow
            key={row.id}
            row={row}
            cellRenderColumns={table.options.columns}
            className='transition-colors'
          />
        )}
      />

      <div className='border-t px-4 py-2.5 sm:px-5'>
        <DataTablePagination table={table} />
      </div>
    </div>
  )
}
