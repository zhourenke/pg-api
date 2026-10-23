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
import type {
  ColumnDef,
  PaginationState,
  SortingState,
} from '@tanstack/react-table'
import { VChart } from '@visactor/react-vchart'
import {
  AreaChart,
  BarChart3,
  ExternalLink,
  TableProperties,
  User as UserIcon,
  Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  DataTablePage,
  DataTablePagination,
  DataTableRow,
  useDataTable,
} from '@/components/data-table'
import { Button } from '@/components/ui/button'
import { IconBadge } from '@/components/ui/icon-badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useTheme } from '@/context/theme-provider'
import { getUserQuotaDataByUsers } from '@/features/dashboard/api'
import { DEFAULT_TIME_GRANULARITY } from '@/features/dashboard/constants'
import { useDashboardWindow } from '@/features/dashboard/hooks/use-dashboard-window'
import {
  formatSharePercent,
  processUserChartData,
  safeDivide,
} from '@/features/dashboard/lib'
import type { UserChartsFilters } from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { VCHART_OPTION } from '@/lib/vchart'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

const TOP_USER_LIMIT_OPTIONS = [5, 10, 20, 50]

interface UserBreakdownItem {
  username: string
  count: number
  quota: number
  tokens: number
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

  const timeGranularity =
    props.filters.timeGranularity ??
    props.filters.time_granularity ??
    DEFAULT_TIME_GRANULARITY
  const topUserLimit = props.filters.topUserLimit ?? 10
  const onFiltersChange = props.onFiltersChange

  const window = useDashboardWindow(props.filters)
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

  const filteredUserData = useMemo(() => {
    if (!userData || userData.length === 0) return []
    const filterUsername = props.filters.username?.trim().toLowerCase()
    if (!filterUsername) return userData
    return userData.filter((item) =>
      item.username?.toLowerCase().includes(filterUsername)
    )
  }, [userData, props.filters.username])

  const chartData = useMemo(
    () =>
      processUserChartData(
        isLoading ? [] : filteredUserData,
        timeGranularity,
        t,
        topUserLimit
      ),
    [filteredUserData, isLoading, timeGranularity, t, topUserLimit]
  )

  const topUsersTableData = useMemo(() => {
    if (filteredUserData.length === 0) return []

    const userMap = new Map<
      string,
      { count: number; quota: number; tokens: number }
    >()
    let totalQuota = 0

    for (const item of filteredUserData) {
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
        quotaShare: safeDivide(stats.quota * 100, totalQuota),
      })
    }

    return rows.sort((a, b) => b.quota - a.quota).slice(0, topUserLimit)
  }, [filteredUserData, topUserLimit])

  const [trendStyle, setTrendStyle] = useState<'area' | 'bar'>('area')
  const spec =
    trendStyle === 'bar' ? chartData.spec_user_bar : chartData.spec_user_trend

  const onSelectUser = props.onSelectUser
  // Same column shape as the model usage table: the shared string header makes
  // the table's own header render a `DataTableColumnHeader`, and every column
  // stays visible because this card has no column-visibility control.
  const userColumns = useMemo<ColumnDef<UserBreakdownItem>[]>(
    () => [
      {
        accessorKey: 'username',
        header: t('User'),
        enableHiding: false,
        meta: { mobileTitle: true },
        cell: ({ row }) => (
          <div className='flex max-w-full min-w-0 items-center gap-2'>
            <span className='bg-muted flex size-6 shrink-0 items-center justify-center rounded-md'>
              <UserIcon className='text-muted-foreground size-3.5' />
            </span>
            <span className='min-w-0 truncate font-semibold'>
              {row.original.username}
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
          <span className='text-foreground min-w-0 truncate font-mono tabular-nums'>
            {formatNumber(row.original.count, locale)}
          </span>
        ),
      },
      {
        accessorKey: 'tokens',
        header: t('Token Count'),
        enableHiding: false,
        cell: ({ row }) => (
          <span className='text-foreground min-w-0 truncate font-mono tabular-nums'>
            {formatTokens(row.original.tokens, '0')}
          </span>
        ),
      },
      ...(onSelectUser
        ? [
            {
              id: 'actions',
              header: t('Actions'),
              enableSorting: false,
              enableHiding: false,
              cell: ({ row }: { row: { original: UserBreakdownItem } }) => (
                <Button
                  size='sm'
                  variant='outline'
                  className='h-6 gap-1 px-2 text-[11px]'
                  onClick={() => onSelectUser(row.original.username)}
                >
                  <ExternalLink className='size-2.5' />
                  <span>{t('Usage Analytics')}</span>
                </Button>
              ),
            } as ColumnDef<UserBreakdownItem>,
          ]
        : []),
    ],
    [locale, onSelectUser, t]
  )

  const [userSorting, setUserSorting] = useState<SortingState>([
    { id: 'quota', desc: true },
  ])
  const [userPagination, setUserPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  })

  const { table: userTable } = useDataTable({
    data: topUsersTableData,
    columns: userColumns,
    sorting: userSorting,
    onSortingChange: setUserSorting,
    pagination: userPagination,
    onPaginationChange: setUserPagination,
    enableRowSelection: false,
  })

  return (
    <div className='space-y-3 sm:space-y-4'>
      {/* User chart card */}
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex w-full flex-col gap-2 border-b px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-3'>
          <div className='flex items-center gap-2'>
            <IconBadge tone='info' size='sm'>
              <Users />
            </IconBadge>
            <div className='text-sm font-semibold'>
              {t('User Consumption Trend')}
            </div>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {/* Trend style: area / bar */}
            <Tabs
              value={trendStyle}
              onValueChange={(val) => setTrendStyle(val as 'area' | 'bar')}
            >
              <TabsList aria-label={t('Trend style')}>
                <TabsTrigger
                  value='area'
                  title={t('Area Chart')}
                  className='gap-1 px-2'
                >
                  <AreaChart data-icon='inline-start' aria-hidden='true' />
                  <span className='hidden sm:inline'>{t('Area Chart')}</span>
                </TabsTrigger>
                <TabsTrigger
                  value='bar'
                  title={t('Bar Chart')}
                  className='gap-1 px-2'
                >
                  <BarChart3 data-icon='inline-start' aria-hidden='true' />
                  <span className='hidden sm:inline'>{t('Bar Chart')}</span>
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {/* Limit selector: Top 5 / 10 / 20 / 50 */}
            <Tabs
              value={String(topUserLimit)}
              onValueChange={(val) => handleTopUserLimitChange(Number(val))}
            >
              <TabsList aria-label={t('Display limit')}>
                {TOP_USER_LIMIT_OPTIONS.map((limit) => (
                  <TabsTrigger key={limit} value={String(limit)}>
                    {t('Top {{count}}', { count: limit })}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
          {isLoading ? (
            <Skeleton className='h-full w-full' />
          ) : (
            themeReady &&
            spec && (
              <VChart
                key={`user-trend-${topUserLimit}-${timeGranularity}-${timeRange.start_timestamp}-${timeRange.end_timestamp}-${resolvedTheme}`}
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

      {/* Top Users Usage Table */}
      <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
        <div className='flex flex-col gap-2.5 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5'>
          <div className='flex items-center gap-2'>
            <IconBadge tone='chart-2' size='sm'>
              <TableProperties />
            </IconBadge>
            <h3 className='text-sm font-semibold'>{t('User Usage Details')}</h3>
          </div>

          <div className='flex flex-wrap items-center gap-2'>
            {/* Limit selector: Top 5 / 10 / 20 / 50 copied from chart */}
            <Tabs
              value={String(topUserLimit)}
              onValueChange={(val) => handleTopUserLimitChange(Number(val))}
            >
              <TabsList aria-label={t('Display limit')}>
                {TOP_USER_LIMIT_OPTIONS.map((limit) => (
                  <TabsTrigger key={limit} value={String(limit)}>
                    {t('Top {{count}}', { count: limit })}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>
        </div>

        <DataTablePage
          table={userTable}
          columns={userColumns}
          isLoading={isLoading}
          emptyTitle={t('No data available')}
          skeletonKeyPrefix='dashboard-user-breakdown-skeleton'
          showPagination={false}
          fixedHeight={false}
          toolbarProps={null}
          // The card already draws the frame, so the shared table container
          // drops its own border instead of nesting two of them.
          tableClassName={cn(
            'rounded-none border-0',
            '[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_td_*]:text-[13px] [&_[data-slot=table]_th]:text-[13px] [&_[data-slot=table]_th_*]:text-[13px]'
          )}
          renderRow={(row) => (
            <DataTableRow
              key={row.id}
              row={row}
              cellRenderColumns={userTable.options.columns}
              className='hover:bg-muted/40 transition-colors'
            />
          )}
        />

        <div className='border-t px-4 py-2.5 sm:px-5'>
          <DataTablePagination table={userTable} />
        </div>
      </div>
    </div>
  )
}
