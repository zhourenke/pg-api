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
  DataTablePagination,
  DataTableRow,
  DataTableView,
  useDataTable,
} from '@/components/data-table'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { safeDivide } from '@/features/dashboard/lib'
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

  const { items } = useMemo(() => {
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
        quotaShare: safeDivide(stats.quota * 100, sumQuota, 1),
        countShare: safeDivide(stats.count * 100, sumCount, 1),
        tokensShare: safeDivide(stats.tokens * 100, sumTokens, 1),
      })
    }

    return {
      items: aggregated,
      totalQuota: sumQuota,
      totalCount: sumCount,
      totalTokens: sumTokens,
    }
  }, [props.data])

  const filteredItems = useMemo(() => {
    const trimmed = searchTerm.trim().toLowerCase()
    if (!trimmed) return items
    return items.filter((item) => item.model.toLowerCase().includes(trimmed))
  }, [items, searchTerm])

  const columns = useMemo<ColumnDef<ModelBreakdownItem>[]>(
    () => [
      {
        accessorKey: 'model',
        header: t('Model'),
        cell: ({ row }) => (
          <div className='flex max-w-[16rem] min-w-0 items-center gap-2 sm:max-w-xs'>
            <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md'>
              <Bot className='text-muted-foreground size-3.5' />
            </span>
            <span
              className='truncate font-mono text-xs font-semibold tracking-tight'
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
        cell: ({ row }) => (
          <div className='flex flex-col items-end gap-0.5 text-right font-mono text-xs'>
            <span className='text-foreground font-semibold tabular-nums'>
              {formatQuota(row.original.quota)}
            </span>
            <span className='text-muted-foreground text-[11px] tabular-nums'>
              {row.original.quotaShare}%
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'count',
        header: t('Requests'),
        cell: ({ row }) => (
          <div className='flex flex-col items-end gap-0.5 text-right font-mono text-xs'>
            <span className='text-foreground tabular-nums'>
              {formatNumber(row.original.count, locale)}
            </span>
            <span className='text-muted-foreground text-[11px] tabular-nums'>
              {row.original.countShare}%
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'tokens',
        header: t('Token Count'),
        cell: ({ row }) => (
          <div className='flex flex-col items-end gap-0.5 text-right font-mono text-xs'>
            <span
              className='text-foreground tabular-nums'
              title={formatNumber(row.original.tokens, locale)}
            >
              {formatTokens(row.original.tokens, '0')}
            </span>
            <span className='text-muted-foreground text-[11px] tabular-nums'>
              {row.original.tokensShare}%
            </span>
          </div>
        ),
      },
      {
        accessorKey: 'avgCostPerCall',
        header: t('Avg Quota'),
        cell: ({ row }) => (
          <div className='text-muted-foreground text-right font-mono text-xs tabular-nums'>
            {row.original.avgCostPerCall > 0
              ? formatQuota(row.original.avgCostPerCall)
              : '--'}
          </div>
        ),
      },
      {
        accessorKey: 'avgTokensPerCall',
        header: t('Avg Tokens Count'),
        cell: ({ row }) => (
          <div className='text-muted-foreground text-right font-mono text-xs tabular-nums'>
            {row.original.avgTokensPerCall > 0
              ? formatTokens(Math.round(row.original.avgTokensPerCall), '0')
              : '--'}
          </div>
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

  if (props.loading) {
    return (
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex items-center justify-between border-b px-4 py-3'>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-8 w-56' />
        </div>
        <div className='space-y-3 p-4'>
          {['sk-1', 'sk-2', 'sk-3', 'sk-4', 'sk-5'].map((key) => (
            <Skeleton key={key} className='h-10 w-full' />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      {/* Header with Title and Search Input */}
      <div className='flex flex-col gap-2.5 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='chart-2' size='sm'>
            <TableProperties />
          </IconBadge>
          <h3 className='text-sm font-semibold'>
            {t('Model Usage Details')}
          </h3>
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

      <DataTableView
        table={table}
        containerClassName='border-0 rounded-none'
        emptyTitle={t('No matching models')}
        emptyDescription={
          items.length === 0 ? t('No data available') : undefined
        }
        tableClassName={cn(
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

      {table.getPageCount() > 1 && (
        <div className='border-t px-4 py-2.5 sm:px-5'>
          <DataTablePagination table={table} />
        </div>
      )}
    </div>
  )
}
