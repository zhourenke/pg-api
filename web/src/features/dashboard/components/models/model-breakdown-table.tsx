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
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  ChevronLeft,
  ChevronRight,
  Search,
  TableProperties,
  X,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { safeDivide } from '@/features/dashboard/lib'
import type { QuotaDataItem } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'

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

type SortField = 'quota' | 'count' | 'tokens' | 'avgCost' | 'model'
type SortOrder = 'asc' | 'desc'

interface ModelBreakdownTableProps {
  data: QuotaDataItem[]
  loading?: boolean
}

const PAGE_SIZE = 10

export function ModelBreakdownTable(props: ModelBreakdownTableProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const [searchTerm, setSearchTerm] = useState('')
  const [sortField, setSortField] = useState<SortField>('quota')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [currentPage, setCurrentPage] = useState(1)

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

  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      let comparison = 0
      if (sortField === 'model') {
        comparison = a.model.localeCompare(b.model)
      } else if (sortField === 'quota') {
        comparison = a.quota - b.quota
      } else if (sortField === 'count') {
        comparison = a.count - b.count
      } else if (sortField === 'tokens') {
        comparison = a.tokens - b.tokens
      } else if (sortField === 'avgCost') {
        comparison = a.avgCostPerCall - b.avgCostPerCall
      }
      return sortOrder === 'desc' ? -comparison : comparison
    })
  }, [filteredItems, sortField, sortOrder])

  const totalPages = Math.max(1, Math.ceil(sortedItems.length / PAGE_SIZE))
  const paginatedItems = sortedItems.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortOrder('desc')
    }
    setCurrentPage(1)
  }

  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className='text-muted-foreground/40 ml-1 size-3' />
    }
    return sortOrder === 'desc' ? (
      <ArrowDown className='text-primary ml-1 size-3' />
    ) : (
      <ArrowUp className='text-primary ml-1 size-3' />
    )
  }

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
          <div className='flex items-center gap-2'>
            <h3 className='text-sm font-semibold'>
              {t('Model Usage Details')}
            </h3>
            <Badge
              variant='secondary'
              className='h-5 px-1.5 font-mono text-[11px]'
            >
              {searchTerm.trim()
                ? `${filteredItems.length} / ${items.length} ${t('models')}`
                : `${items.length} ${t('models')}`}
            </Badge>
          </div>
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
                setCurrentPage(1)
              }}
              className='h-8 pr-7 pl-8 text-xs'
            />
            {searchTerm && (
              <button
                type='button'
                onClick={() => {
                  setSearchTerm('')
                  setCurrentPage(1)
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

      {/* Table Content */}
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader>
            <TableRow className='hover:bg-transparent'>
              <TableHead
                className='cursor-pointer font-medium select-none'
                onClick={() => handleSort('model')}
              >
                <div className='flex items-center'>
                  <span>{t('Model')}</span>
                  {renderSortIndicator('model')}
                </div>
              </TableHead>
              <TableHead
                className='cursor-pointer text-right font-medium select-none'
                onClick={() => handleSort('quota')}
              >
                <div className='flex items-center justify-end'>
                  <span>{t('Quota')}</span>
                  {renderSortIndicator('quota')}
                </div>
              </TableHead>
              <TableHead
                className='cursor-pointer text-right font-medium select-none'
                onClick={() => handleSort('count')}
              >
                <div className='flex items-center justify-end'>
                  <span>{t('Calls')}</span>
                  {renderSortIndicator('count')}
                </div>
              </TableHead>
              <TableHead
                className='cursor-pointer text-right font-medium select-none'
                onClick={() => handleSort('tokens')}
              >
                <div className='flex items-center justify-end'>
                  <span>{t('Tokens')}</span>
                  {renderSortIndicator('tokens')}
                </div>
              </TableHead>
              <TableHead
                className='cursor-pointer text-right font-medium select-none'
                onClick={() => handleSort('avgCost')}
              >
                <div className='flex items-center justify-end'>
                  <span>{t('Avg Cost')}</span>
                  {renderSortIndicator('avgCost')}
                </div>
              </TableHead>
              <TableHead className='text-right font-medium'>
                <span>{t('Avg Tokens')}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedItems.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className='text-muted-foreground h-32 text-center text-xs'
                >
                  {items.length === 0
                    ? t('No data available')
                    : t('No matching models')}
                </TableCell>
              </TableRow>
            ) : (
              paginatedItems.map((item) => (
                <TableRow key={item.model} className='hover:bg-muted/40'>
                  {/* Model Name */}
                  <TableCell className='max-w-[16rem] py-2.5 sm:max-w-xs'>
                    <div className='flex items-center gap-2'>
                      <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md'>
                        <Bot className='text-muted-foreground size-3.5' />
                      </span>
                      <span
                        className='truncate font-mono text-xs font-semibold tracking-tight'
                        title={item.model}
                      >
                        {item.model}
                      </span>
                    </div>
                  </TableCell>

                  {/* Quota & Share */}
                  <TableCell className='py-2.5 text-right font-mono text-xs'>
                    <div className='flex flex-col items-end gap-1'>
                      <span className='text-foreground font-semibold tabular-nums'>
                        {formatQuota(item.quota)}
                      </span>
                      <div className='flex items-center gap-1.5'>
                        <div className='bg-muted h-1.5 w-12 overflow-hidden rounded-full'>
                          <div
                            className='bg-success h-full rounded-full'
                            style={{
                              width: `${Math.min(100, item.quotaShare)}%`,
                            }}
                          />
                        </div>
                        <span className='text-muted-foreground text-[10px] tabular-nums'>
                          {item.quotaShare}%
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  {/* Call Count & Share */}
                  <TableCell className='py-2.5 text-right font-mono text-xs'>
                    <div className='flex flex-col items-end gap-1'>
                      <span className='text-foreground tabular-nums'>
                        {formatNumber(item.count, locale)}
                      </span>
                      <div className='flex items-center gap-1.5'>
                        <div className='bg-muted h-1.5 w-12 overflow-hidden rounded-full'>
                          <div
                            className='bg-info h-full rounded-full'
                            style={{
                              width: `${Math.min(100, item.countShare)}%`,
                            }}
                          />
                        </div>
                        <span className='text-muted-foreground text-[10px] tabular-nums'>
                          {item.countShare}%
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  {/* Tokens & Share */}
                  <TableCell className='py-2.5 text-right font-mono text-xs'>
                    <div className='flex flex-col items-end gap-1'>
                      <span
                        className='text-foreground tabular-nums'
                        title={formatNumber(item.tokens, locale)}
                      >
                        {formatCompactNumber(item.tokens, locale)}
                      </span>
                      <div className='flex items-center gap-1.5'>
                        <div className='bg-muted h-1.5 w-12 overflow-hidden rounded-full'>
                          <div
                            className='bg-chart-4 h-full rounded-full'
                            style={{
                              width: `${Math.min(100, item.tokensShare)}%`,
                            }}
                          />
                        </div>
                        <span className='text-muted-foreground text-[10px] tabular-nums'>
                          {item.tokensShare}%
                        </span>
                      </div>
                    </div>
                  </TableCell>

                  {/* Avg Cost / Call */}
                  <TableCell className='text-muted-foreground py-2.5 text-right font-mono text-xs tabular-nums'>
                    {item.avgCostPerCall > 0
                      ? formatQuota(item.avgCostPerCall)
                      : '--'}
                  </TableCell>

                  {/* Avg Tokens / Call */}
                  <TableCell className='text-muted-foreground py-2.5 text-right font-mono text-xs tabular-nums'>
                    {item.avgTokensPerCall > 0
                      ? formatCompactNumber(
                          Math.round(item.avgTokensPerCall),
                          locale
                        )
                      : '--'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Footer */}
      {totalPages > 1 && (
        <div className='flex items-center justify-between border-t px-4 py-2.5 sm:px-5'>
          <div className='text-muted-foreground font-mono text-xs'>
            {currentPage} / {totalPages}
          </div>
          <div className='flex items-center gap-1.5'>
            <Button
              variant='outline'
              size='sm'
              className='h-7 px-2.5 text-xs'
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              aria-label={t('Previous page')}
            >
              <ChevronLeft className='mr-1 size-3' />
              <span>{t('Previous page')}</span>
            </Button>
            <Button
              variant='outline'
              size='sm'
              className='h-7 px-2.5 text-xs'
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              aria-label={t('Next page')}
            >
              <span>{t('Next page')}</span>
              <ChevronRight className='ml-1 size-3' />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
