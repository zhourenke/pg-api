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
import { useQuery } from '@tanstack/react-query'
import { VChart } from '@visactor/react-vchart'
import {
  ExternalLink,
  Loader2,
  TableProperties,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useTheme } from '@/context/theme-provider'
import { getUserQuotaDataByUsers } from '@/features/dashboard/api'
import { useDashboardWindow } from '@/features/dashboard/hooks/use-dashboard-window'
import { processUserChartData, safeDivide } from '@/features/dashboard/lib'
import type {
  ProcessedUserChartData,
  UserChartsFilters,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const USER_CHARTS: {
  value: string
  labelKey: string
  specKey: keyof ProcessedUserChartData
}[] = [
  {
    value: 'rank',
    labelKey: 'User Consumption Ranking',
    specKey: 'spec_user_rank',
  },
  {
    value: 'trend',
    labelKey: 'User Consumption Trend',
    specKey: 'spec_user_trend',
  },
]

const TOP_USER_LIMIT_OPTIONS = [5, 10, 20, 50]

interface UserBreakdownItem {
  username: string
  count: number
  quota: number
  tokens: number
  avgCostPerCall: number
  quotaShare: number
}

interface UserChartsProps {
  filters: UserChartsFilters
  onFiltersChange: (filters: UserChartsFilters) => void
  onSelectUser?: (username: string) => void
}

export function UserCharts(props: UserChartsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const { resolvedTheme } = useTheme()
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)

  const timeGranularity = props.filters.timeGranularity
  const preset = props.filters.preset
  const topUserLimit = props.filters.topUserLimit
  const onFiltersChange = props.onFiltersChange

  const window = useDashboardWindow({ preset })
  const timeRange = useMemo(
    () => ({
      start_timestamp: window.start,
      end_timestamp: window.end,
    }),
    [window]
  )

  const handleTopUserLimitChange = useCallback(
    (limit: number) => {
      onFiltersChange({ ...props.filters, topUserLimit: limit })
    },
    [onFiltersChange, props.filters]
  )

  useEffect(() => {
    const updateTheme = async () => {
      setThemeReady(false)
      if (!themeManagerPromise) {
        themeManagerPromise = import('@visactor/vchart').then(
          (m) => m.ThemeManager
        )
      }
      const ThemeManager = await themeManagerPromise
      themeManagerRef.current = ThemeManager
      ThemeManager.setCurrentTheme(resolvedTheme === 'dark' ? 'dark' : 'light')
      setThemeReady(true)
    }
    updateTheme()
  }, [resolvedTheme])

  const { data: userData, isLoading } = useQuery({
    queryKey: ['dashboard', 'user-quota', timeRange],
    queryFn: async () =>
      requireServerSuccess(await getUserQuotaDataByUsers(timeRange)),
    select: (res) => (res.success ? res.data : []),
    staleTime: 60_000,
  })

  const chartData = useMemo(
    () =>
      processUserChartData(
        isLoading ? [] : (userData ?? []),
        timeGranularity,
        t,
        topUserLimit
      ),
    [userData, isLoading, timeGranularity, t, topUserLimit]
  )

  const topUsersTableData = useMemo(() => {
    if (!userData || userData.length === 0) return []

    const userMap = new Map<
      string,
      { count: number; quota: number; tokens: number }
    >()
    let totalQuota = 0

    for (const item of userData) {
      const name = item.username || 'Unknown'
      const quota = Number(item.quota) || 0
      const count = Number(item.count) || 0
      const tokens = Number(item.token_used) || 0

      totalQuota += quota

      const cur = userMap.get(name) || { count: 0, quota: 0, tokens: 0 }
      userMap.set(name, {
        count: cur.count + count,
        quota: cur.quota + quota,
        tokens: cur.tokens + tokens,
      })
    }

    const rows: UserBreakdownItem[] = []
    for (const [name, stats] of userMap.entries()) {
      rows.push({
        username: name,
        count: stats.count,
        quota: stats.quota,
        tokens: stats.tokens,
        avgCostPerCall: safeDivide(stats.quota, stats.count),
        quotaShare: safeDivide(stats.quota * 100, totalQuota, 1),
      })
    }

    return rows.sort((a, b) => b.quota - a.quota).slice(0, topUserLimit)
  }, [userData, topUserLimit])

  return (
    <div className='space-y-3 sm:space-y-4'>
      {/* Top control bar: Top User Limit */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex items-center gap-2'>
          <IconBadge tone='info' size='sm'>
            <Users className='size-3.5' />
          </IconBadge>
          <span className='text-xs font-semibold text-foreground'>
            {t('User Analytics')}
          </span>
          {isLoading && (
            <Loader2 className='text-muted-foreground size-3.5 animate-spin' />
          )}
        </div>

        <div className='flex items-center gap-1.5'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Top Users')}:
          </span>
          <div className='bg-muted/60 inline-flex h-7 items-center rounded-lg border p-0.5 sm:h-8'>
            {TOP_USER_LIMIT_OPTIONS.map((limit) => (
              <button
                key={limit}
                type='button'
                onClick={() => handleTopUserLimitChange(limit)}
                className={cn(
                  'shrink-0 rounded-md px-2.5 text-xs font-medium transition-colors',
                  topUserLimit === limit
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t('Top {{count}}', { count: limit })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* User charts */}
      <div className='grid gap-3 sm:gap-4'>
        {USER_CHARTS.map((chart) => {
          const spec = chartData[chart.specKey]

          return (
            <div
              key={chart.value}
              className='bg-card overflow-hidden rounded-xl border shadow-xs'
            >
              <div className='flex w-full items-center gap-2 border-b px-3 py-2.5 sm:px-5 sm:py-3'>
                <IconBadge tone='info' size='sm'>
                  <Users />
                </IconBadge>
                <div className='text-sm font-semibold'>{t(chart.labelKey)}</div>
              </div>

              <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
                {isLoading ? (
                  <Skeleton className='h-full w-full' />
                ) : (
                  themeReady &&
                  spec && (
                    <VChart
                      key={`user-${chart.value}-${topUserLimit}-${timeGranularity}-${timeRange.start_timestamp}-${timeRange.end_timestamp}-${resolvedTheme}`}
                      spec={{
                        ...spec,
                        theme: resolvedTheme === 'dark' ? 'dark' : 'light',
                        background: 'transparent',
                      }}
                      option={VCHART_OPTION}
                    />
                  )
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Top Users Usage Table with Drill-down Action */}
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex items-center justify-between border-b px-4 py-3 sm:px-5'>
          <div className='flex items-center gap-2'>
            <IconBadge tone='chart-2' size='sm'>
              <TableProperties />
            </IconBadge>
            <div className='flex items-center gap-2'>
              <h3 className='text-sm font-semibold'>
                {t('User Usage Details')}
              </h3>
              <Badge
                variant='secondary'
                className='h-5 px-1.5 font-mono text-[11px]'
              >
                TOP {topUsersTableData.length}
              </Badge>
            </div>
          </div>
        </div>

        <div className='overflow-x-auto'>
          <Table>
            <TableHeader>
              <TableRow className='hover:bg-transparent'>
                <TableHead className='font-medium'>{t('User')}</TableHead>
                <TableHead className='text-right font-medium'>
                  {t('Quota')}
                </TableHead>
                <TableHead className='text-right font-medium'>
                  {t('Calls')}
                </TableHead>
                <TableHead className='text-right font-medium'>
                  {t('Tokens')}
                </TableHead>
                <TableHead className='text-right font-medium'>
                  {t('Avg Cost')}
                </TableHead>
                {props.onSelectUser && (
                  <TableHead className='text-right font-medium'>
                    {t('Action')}
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {topUsersTableData.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={props.onSelectUser ? 6 : 5}
                    className='text-muted-foreground h-24 text-center text-xs'
                  >
                    {t('No data available')}
                  </TableCell>
                </TableRow>
              ) : (
                topUsersTableData.map((item) => (
                  <TableRow key={item.username} className='hover:bg-muted/40'>
                    <TableCell className='py-2.5 font-mono text-xs'>
                      <div className='flex items-center gap-2'>
                        <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md'>
                          <UserIcon className='text-muted-foreground size-3.5' />
                        </span>
                        <span className='font-semibold'>{item.username}</span>
                      </div>
                    </TableCell>

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

                    <TableCell className='text-foreground py-2.5 text-right font-mono text-xs tabular-nums'>
                      {formatNumber(item.count, locale)}
                    </TableCell>

                    <TableCell className='text-foreground py-2.5 text-right font-mono text-xs tabular-nums'>
                      {formatCompactNumber(item.tokens, locale)}
                    </TableCell>

                    <TableCell className='text-muted-foreground py-2.5 text-right font-mono text-xs tabular-nums'>
                      {item.avgCostPerCall > 0
                        ? formatQuota(item.avgCostPerCall)
                        : '--'}
                    </TableCell>

                    {props.onSelectUser && (
                      <TableCell className='py-2.5 text-right'>
                        <Button
                          size='sm'
                          variant='outline'
                          className='h-6 gap-1 px-2 text-[11px]'
                          onClick={() => props.onSelectUser?.(item.username)}
                        >
                          <ExternalLink className='size-2.5' />
                          <span>{t('Analyze User')}</span>
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  )
}
