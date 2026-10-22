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

type ChartMetric = 'count' | 'quota' | 'tokens'

const METRIC_OPTIONS: {
  value: ChartMetric
  labelKey: string
  icon: typeof Hash
}[] = [
  { value: 'count', labelKey: 'By requests', icon: Hash },
  { value: 'quota', labelKey: 'By quota', icon: Coins },
  { value: 'tokens', labelKey: 'By tokens', icon: Layers },
]

const VIEW_TAB_OPTIONS: {
  value: ModelAnalyticsChartTab
  labelKey: string
}[] = [
  { value: 'trend', labelKey: 'Trend' },
  { value: 'proportion', labelKey: 'Share' },
  { value: 'top', labelKey: 'Ranking' },
]

interface ModelChartsProps {
  data: QuotaDataItem[]
  loading?: boolean
  timeGranularity?: TimeGranularity
  defaultChartTab?: ModelAnalyticsChartTab
}

function resolveSpec(
  chartData: ProcessedChartData,
  tab: ModelAnalyticsChartTab,
  metric: ChartMetric,
  trendStyle: 'area' | 'bar' = 'area'
) {
  if (metric === 'quota') {
    if (tab === 'trend') {
      return trendStyle === 'bar' ? chartData.spec_line : chartData.spec_area
    }
    if (tab === 'proportion') {
      return chartData.spec_pie_quota ?? chartData.spec_pie
    }
    return chartData.spec_rank_quota ?? chartData.spec_rank_bar
  }
  if (metric === 'tokens') {
    if (tab === 'trend') {
      return chartData.spec_token_line ?? chartData.spec_model_line
    }
    if (tab === 'proportion') {
      return chartData.spec_pie_tokens ?? chartData.spec_pie
    }
    return chartData.spec_rank_tokens ?? chartData.spec_rank_bar
  }
  // count
  if (tab === 'trend') return chartData.spec_model_line
  if (tab === 'proportion') return chartData.spec_pie
  return chartData.spec_rank_bar
}

export function ModelCharts(props: ModelChartsProps) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const { customization } = useThemeCustomization()
  const chartRadius = useThemeRadiusPx(
    '--radius-md',
    `${customization.preset}:${customization.radius}`
  )
  const [activeTab, setActiveTab] = useState<ModelAnalyticsChartTab>(
    props.defaultChartTab ?? 'trend'
  )
  const [metric, setMetric] = useState<ChartMetric>('count')
  const [trendStyle, setTrendStyle] = useState<'area' | 'bar'>('area')
  const [themeReady, setThemeReady] = useState(false)
  const themeManagerRef = useRef<
    (typeof import('@visactor/vchart'))['ThemeManager'] | null
  >(null)
  const timeGranularity = props.timeGranularity ?? DEFAULT_TIME_GRANULARITY

  useEffect(() => {
    if (props.defaultChartTab) setActiveTab(props.defaultChartTab)
  }, [props.defaultChartTab])

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

  const spec = resolveSpec(chartData, activeTab, metric, trendStyle)
  const specType = typeof spec?.type === 'string' ? spec.type : activeTab
  const chartKey = [
    activeTab,
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

  let totalDisplay = chartData.totalCountDisplay
  if (metric === 'quota') totalDisplay = chartData.totalQuotaDisplay
  else if (metric === 'tokens') totalDisplay = chartData.totalTokensDisplay

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
            {t('Model Call Analytics')}
          </div>
          <span className='text-muted-foreground font-mono text-xs tabular-nums'>
            {t('Total:')} {totalDisplay}
          </span>
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

          {/* View Tab Selector */}
          <Tabs
            value={activeTab}
            onValueChange={(val) => setActiveTab(val as ModelAnalyticsChartTab)}
          >
            <TabsList aria-label={t('View')}>
              {VIEW_TAB_OPTIONS.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className='px-2.5'
                >
                  {t(tab.labelKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>

          {/* Quota Trend Style (Area vs Bar) */}
          {activeTab === 'trend' && metric === 'quota' && (
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
