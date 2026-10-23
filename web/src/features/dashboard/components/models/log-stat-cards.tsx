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
import { Coins, Hash, Layers } from 'lucide-react'
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
import { formatNumber, formatQuota, formatTokens } from '@/lib/format'

interface LogStatCardsProps {
  stats?: ExtendedDashboardStats
  loading?: boolean
  error?: boolean
  filters?: DashboardFilters
  onDataUpdate?: (data: QuotaDataItem[], loading: boolean) => void
  /** Admin (platform-wide) view, as chosen in the page title bar. */
  isAdminView: boolean
}

export function LogStatCards(props: LogStatCardsProps) {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)

  const queried = useDashboardData(
    props.stats ? undefined : props.filters,
    props.isAdminView
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

  const cardItems = [
    {
      key: 'quota',
      title: t('Total Quota'),
      value: formatQuota(stats.totalQuota),
      icon: Coins,
      iconTone: 'success' as const,
      tone: 'accent-2' as const,
    },
    {
      key: 'count',
      title: t('Total Requests'),
      value: formatNumber(stats.totalCount, locale),
      icon: Hash,
      iconTone: 'info' as const,
      tone: 'accent-1' as const,
    },
    {
      key: 'tokens',
      title: t('Total Tokens'),
      value: formatTokens(stats.totalTokens, '0'),
      icon: Layers,
      iconTone: 'chart-4' as const,
      tone: 'accent-3' as const,
    },
  ]

  return (
    <div className='grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3'>
      {cardItems.map((item) => (
        <div
          key={item.key}
          className='bg-card overflow-hidden rounded-xl border p-2.5 shadow-xs sm:p-3'
        >
          <StatCard
            title={item.title}
            value={item.value}
            icon={item.icon}
            iconTone={item.iconTone}
            tone={item.tone}
            loading={isLoading}
            error={isError}
            compactMobile
          />
        </div>
      ))}
    </div>
  )
}
