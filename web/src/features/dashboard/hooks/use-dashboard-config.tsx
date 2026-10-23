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
import { Activity, Flame, TrendingUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function useSummaryCardsConfig(totals: {
  todayUsageDisplay: string
  usedDisplay: string
  requestCountDisplay: string
  currencyLabel: string
  currencyEnabled: boolean
  isAllScope?: boolean
}) {
  const { t } = useTranslation()

  return [
    {
      key: 'todayUsage',
      title: totals.isAllScope
        ? t('Last 24h platform usage')
        : t('Last 24h usage'),
      value: totals.todayUsageDisplay,
      description: totals.currencyEnabled
        ? `${t(totals.isAllScope ? 'Platform consumed in the last 24 hours' : 'Consumed in the last 24 hours')} (${totals.currencyLabel})`
        : t(
            totals.isAllScope
              ? 'Platform consumed in the last 24 hours'
              : 'Consumed in the last 24 hours'
          ),
      icon: Flame,
    },
    {
      key: 'usage',
      title: t('Historical Usage'),
      value: totals.usedDisplay,
      description: totals.currencyEnabled
        ? `${t('Total consumed')} (${totals.currencyLabel})`
        : t('Total consumed quota'),
      icon: TrendingUp,
    },
    {
      key: 'requests',
      title: t('Request Count'),
      value: totals.requestCountDisplay,
      description: t('Total requests made'),
      icon: Activity,
    },
  ]
}
