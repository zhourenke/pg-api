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
import { Coins, Gauge, Hash, Layers, Zap } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { StatCard } from '@/features/dashboard/components/ui/stat-card'
import { useDashboardData } from '@/features/dashboard/hooks/use-dashboard-data'
import type { ExtendedDashboardStats } from '@/features/dashboard/lib'
import type {
  DashboardFilters,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatCompactNumber, formatNumber, formatQuota } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface LogStatCardsProps {
  stats?: ExtendedDashboardStats
  loading?: boolean
  error?: boolean
  filters?: DashboardFilters
  onDataUpdate?: (data: QuotaDataItem[], loading: boolean) => void
}

export function LogStatCards(props: LogStatCardsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = Boolean(user?.role && user.role >= 10)

  const queried = useDashboardData(
    props.stats ? undefined : props.filters,
    isAdmin
  )

  const stats = props.stats ?? queried.stats
  const isLoading =
    props.loading !== undefined ? props.loading : queried.isLoading
  const isError = props.error !== undefined ? props.error : queried.isError

  const onDataUpdate = props.onDataUpdate
  const queriedData = queried.data

  useEffect(() => {
    if (onDataUpdate && !props.stats) {
      onDataUpdate(queriedData, isLoading)
    }
  }, [queriedData, isLoading, onDataUpdate, props.stats])

  const avgCostDisplay =
    stats.avgCostPerRequest > 0
      ? `${formatQuota(stats.avgCostPerRequest)} / ${t('call')}`
      : '--'

  const avgTokensDisplay =
    stats.totalCount > 0
      ? `${formatNumber(Math.round(stats.avgTokensPerRequest), locale)} Tokens / ${t('call')}`
      : '--'

  const cardItems = [
    {
      key: 'quota',
      title: t('Total Quota'),
      value: formatQuota(stats.totalQuota),
      desc: t('Statistical quota'),
      icon: Coins,
      iconTone: 'success' as const,
      tone: 'accent-2' as const,
      sparkline: stats.sparklines.quota,
      sparklineVariant: 'bars' as const,
    },
    {
      key: 'count',
      title: t('Total Count'),
      value: formatNumber(stats.totalCount, locale),
      desc: t('Statistical count'),
      icon: Hash,
      iconTone: 'info' as const,
      tone: 'accent-1' as const,
      sparkline: stats.sparklines.count,
      sparklineVariant: 'bars' as const,
    },
    {
      key: 'tokens',
      title: t('Total Tokens'),
      value: formatCompactNumber(stats.totalTokens, locale),
      desc: t('Statistical tokens'),
      icon: Layers,
      iconTone: 'chart-4' as const,
      tone: 'accent-3' as const,
      sparkline: stats.sparklines.tokens,
      sparklineVariant: 'bars' as const,
    },
    {
      key: 'rate',
      title: t('Average Rate'),
      value: `${formatCompactNumber(stats.avgRpm, locale)} RPM`,
      desc: `${formatCompactNumber(stats.avgTpm, locale)} TPM`,
      icon: Gauge,
      iconTone: 'chart-2' as const,
      tone: 'accent-1' as const,
      details: [
        { label: 'RPM', value: formatNumber(stats.avgRpm, locale) },
        { label: 'TPM', value: formatCompactNumber(stats.avgTpm, locale) },
      ],
    },
    {
      key: 'unit_economics',
      title: t('Unit Economics'),
      value: avgCostDisplay,
      desc: avgTokensDisplay,
      icon: Zap,
      iconTone: 'warning' as const,
      tone: 'accent-2' as const,
      details: [
        {
          label: t('Active Models'),
          value: formatNumber(stats.uniqueModelsCount, locale),
        },
        isAdmin
          ? {
              label: t('Active Users'),
              value: formatNumber(stats.uniqueUsersCount, locale),
            }
          : {
              label: t('Tokens/req'),
              value: formatCompactNumber(stats.avgTokensPerRequest, locale),
            },
      ],
    },
  ]

  return (
    <div className='grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-5'>
      {cardItems.map((item, index) => (
        <div
          key={item.key}
          className={cn(
            'bg-card overflow-hidden rounded-xl border p-2.5 shadow-xs sm:p-3',
            index === cardItems.length - 1 &&
              cardItems.length % 2 !== 0 &&
              'col-span-2 sm:col-span-1'
          )}
        >
          <StatCard
            title={item.title}
            value={item.value}
            description={item.desc}
            icon={item.icon}
            iconTone={item.iconTone}
            tone={item.tone}
            sparkline={'sparkline' in item ? item.sparkline : undefined}
            sparklineVariant={
              'sparklineVariant' in item ? item.sparklineVariant : undefined
            }
            details={'details' in item ? item.details : undefined}
            loading={isLoading}
            error={isError}
            compactMobile
          />
        </div>
      ))}
    </div>
  )
}
