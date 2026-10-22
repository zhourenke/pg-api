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
import { VChart } from '@visactor/react-vchart'
import {
  AreaChart,
  BarChart3,
  Coins,
  Hash,
  Layers,
  PieChart as PieChartIcon,
} from 'lucide-react'
import { useEffect, useMemo, useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useThemeCustomization } from '@/context/theme-customization-provider'
import { useTheme } from '@/context/theme-provider'
import { DEFAULT_TIME_GRANULARITY } from '@/features/dashboard/constants'
import { processChartData } from '@/features/dashboard/lib'
import type {
  ModelAnalyticsChartTab,
  ProcessedChartData,
  QuotaDataItem,
} from '@/features/dashboard/types'
import { useThemeRadiusPx } from '@/lib/theme-radius'
import type { TimeGranularity } from '@/lib/time'
import { VCHART_OPTION } from '@/lib/vchart'

let themeManagerPromise: Promise<
  (typeof import('@visactor/vchart'))['ThemeManager']
> | null = null

type ChartMetric = 'quota' | 'count' | 'tokens'

const METRIC_OPTIONS: {
  value: ChartMetric
  labelKey: string
  icon: typeof Coins
}[] = [
  { value: 'quota', labelKey: 'By quota', icon: Coins },
  { value: 'count', labelKey: 'By requests', icon: Hash },
  { value: 'tokens', labelKey: 'By tokens', icon: Layers },
]

interface ModelChartsProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  defaultChartTab?: ModelAnalyticsChartTab
}

function resolveSpec(
  chartData: ProcessedChartData,
  metric: ChartMetric,
  trendStyle: 'area' | 'bar' = 'area'
) {
  if (metric === 'quota') {
    return trendStyle === 'bar' ? chartData.spec_line : chartData.spec_area
  }
  if (metric === 'tokens') {
    return chartData.spec_token_line ?? chartData.spec_model_line
  }
  return chartData.spec_model_line
}

export function ModelCharts(props: ModelChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const { customization } = useThemeCustomization()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${customization.preset}:${customization.radius}`
  )
  const [metric, setMetric] = useState<ChartMetric>('quota')
  const [trendStyle, setTrendStyle] = useState<'area' | 'bar'>('area')
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

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

  const chartData = useMemo(
    () =>
      processChartData(
        props.loading ? [] : props.data,
        timeGranularity,
        t,
        chartRadius
      ),
    [props.data, props.loading, timeGranularity, t, chartRadius]
  )

  const spec = resolveSpec(chartData, metric, trendStyle)
  const specType = typeof spec?.type === 'string' ? spec.type : 'trend'
  const chartKey = [
    'trend',
    metric,
    trendStyle,
    specType,
    timeGranularity,
    props.loading ? 'loading' : 'ready',
    props.data.length,
    props.data.at(0)?.created_at ?? 0,
    props.data.at(-1)?.created_at ?? 0,
    resolvedTheme,
    customization.preset,
  ].join('-')

  let titleTone: 'success' | 'chart-4' | 'info' = 'info'
  if (metric === 'quota') {
    titleTone = 'success'
  } else if (metric === 'tokens') {
    titleTone = 'chart-4'
  }

  return (
    <div className='bg-card overflow-hidden rounded-xl border shadow-xs'>
      <div className='flex w-full flex-col gap-2 border-b px-3 py-2.5 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
        <div className='flex items-center gap-2'>
          <IconBadge tone={titleTone} size='sm'>
            <PieChartIcon />
          </IconBadge>
          <div className='text-sm font-semibold'>
            {t('Model Call Trend')}
          </div>
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {/* Metric Selector */}
          <Tabs
            value={metric}
            onValueChange={(val) => setMetric(val as ChartMetric)}
          >
            <TabsList aria-label={t('Metric')}>
              {METRIC_OPTIONS.map((opt) => {
                const Icon = opt.icon
                return (
                  <TabsTrigger
                    key={opt.value}
                    value={opt.value}
                    className='gap-1.5 px-2.5'
                  >
                    <Icon data-icon='inline-start' aria-hidden='true' />
                    <span>{t(opt.labelKey)}</span>
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>

          {/* Quota Trend Style (Area vs Bar) */}
          {metric === 'quota' && (
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
          )}
        </div>
      </div>

      <div className='h-[300px] p-1.5 sm:h-96 sm:p-2'>
        {themeReady && spec && (
          <VChart
            key={chartKey}
            spec={{
              ...spec,
              theme: resolvedTheme === 'dark' ? 'dark' : 'light',
              background: 'transparent',
            }}
            option={VCHART_OPTION}
          />
        )}
      </div>
    </div>
  )
}
