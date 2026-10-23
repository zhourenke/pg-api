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
import type {
  ColumnDef,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import { Bot, Search, TableProperties, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  DataTablePagination,
  DataTableRow,
  useDataTable,
} from '@/components/data-table'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { formatSharePercent, safeDivide } from '@/features/dashboard/lib'
import type { QuotaDataItem } from '@/features/dashboard/types'
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

interface ModelBreakdownTableProps {
  data: QuotaDataItem[]
  loading?: boolean
}

const PAGE_SIZE = 10

export function ModelBreakdownTable(props: ModelBreakdownTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [searchTerm, setSearchTerm] = useState('')
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'quota', desc: true },
  ])
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
        quotaShare: safeDivide(stats.quota * 100, sumQuota),
        countShare: safeDivide(stats.count * 100, sumCount),
        tokensShare: safeDivide(stats.tokens * 100, sumTokens),
      })
    }

    return aggregated
  }, [props.data])

  const filteredItems = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase()
    if (!trimmed) return items
    return items.filter((item) => item.model.toLowerCase().includes(trimmed))
  }, [items, searchTerm])

  // Every column keeps the shared string header, so the table's own header
  // component renders it as the same sortable `DataTableColumnHeader` the model
  // square and the other console tables use. `enableHiding` is off because this
  // table has no column-visibility control: a hidden column would have no way
  // back.
  const columns = useMemo<ColumnDef<ModelBreakdownItem>[]>(
    () => [
      {
        accessorKey: 'model',
        header: t('Model'),
        enableHiding: false,
        cell: ({ row }) => (
          <div className='flex max-w-full min-w-0 items-center gap-2'>
            <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md'>
              <Bot className='text-muted-foreground size-3.5' />
            </span>
            <span
              className='min-w-0 truncate font-mono font-semibold'
              title={row.original.model}
            >
              {row.original.model}
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'quota',
        header: t('Quota'),
        enableHiding: false,
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
        enableHiding: false,
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
        enableHiding: false,
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
        enableHiding: false,
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
        enableHiding: false,
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
    data: filteredItems,
    columns,
    sorting,
    onSortingChange: setSorting,
    pagination,
    onPaginationChange: setPagination,
    enableRowSelection: false,
  })

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      {/* Header with Title and Search Input */}
      <div className='flex flex-col gap-2.5 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-2' size='sm'>
            <TableProperties />
          </IconBadge>
          <h3 className='text-sm font-semibold'>{t('Model Usage Details')}</h3>
        </div>

        <div className='flex items-center gap-2'>
          <div className='relative w-full sm:w-60'>
            <Search className='text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
            <Input
              type='text'
              placeholder={t('Search models...')}
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value)
                setPagination((prev) => ({ ...prev, pageIndex: 0 }))
              }}
              className='h-8 pr-7 pl-8 text-xs'
            />
            {searchTerm && (
              <button
                type='button'
                onClick={() => {
                  setSearchTerm('')
                  setPagination((prev) => ({ ...prev, pageIndex: 0 }))
                }}
                className='text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-xs p-0.5'
                aria-label={t('Reset')}
              >
                <X className='size-3' />
              </button>
            )}
          </div>
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
        // The card already draws the frame, so the shared table container drops
        // its own border instead of nesting two of them.
        tableClassName={cn(
          'rounded-none border-0',
          '[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_td_*]:text-[13px] [&_[data-slot=table]_th]:text-[13px] [&_[data-slot=table]_th_*]:text-[13px]'
        )}
        renderRow={(row) => (
          <DataTableRow
            key={row.id}
            row={row}
            cellRenderColumns={table.options.columns}
            className='hover:bg-muted/40 transition-colors'
          />
        )}
      />

      <div className='border-t px-4 py-2.5 sm:px-5'>
        <DataTablePagination table={table} />
      </div>
    </div>
  )
}
