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
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  lazy,
  Suspense,
} from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { FadeIn } from '@/components/page-transition'
import { Skeleton } from '@/components/ui/skeleton'
import { ViewScopeToggle, type ViewScope } from '@/components/view-scope-toggle'
import { ROLE } from '@/lib/roles'
import {
  readSiteDefaultTimeGranularity,
  statusQueryOptions,
} from '@/lib/status-query'
import { useAuthStore } from '@/stores/auth-store'

import { OverviewDashboard } from './components/overview/overview-dashboard'
import { DashboardToolbar } from './components/ui/dashboard-toolbar'
import { DEFAULT_TIME_GRANULARITY } from './constants'
import { useDashboardData } from './hooks/use-dashboard-data'
import { refreshDashboardWindow } from './hooks/use-dashboard-window'
import {
  buildDefaultDashboardFilters,
  getSavedChartPreferences,
  getSavedGranularity,
  hasLocalGranularityChoice,
} from './lib'
import {
  type DashboardSectionId,
  DASHBOARD_DEFAULT_SECTION,
  DASHBOARD_SECTION_IDS,
} from './section-registry'
import type {
  DashboardChartPreferences,
  DashboardFilters,
  UserChartsFilters,
} from './types'

const route = getRouteApi('/_authenticated/dashboard/$section')

const LOG_STAT_CARD_FALLBACK_KEYS = ['quota', 'count', 'tokens'] as const

const LazyLogStatCards = lazy(() =>
  import('./components/models/log-stat-cards').then((m) => ({
    default: m.LogStatCards,
  }))
)

const LazyModelCharts = lazy(() =>
  import('./components/models/model-charts').then((m) => ({
    default: m.ModelCharts,
  }))
)

const LazyModelBreakdownTable = lazy(() =>
  import('./components/models/model-breakdown-table').then((m) => ({
    default: m.ModelBreakdownTable,
  }))
)

const LazyUserCharts = lazy(() =>
  import('./components/users/user-charts').then((m) => ({
    default: m.UserCharts,
  }))
)

const LazyFlowCharts = lazy(() =>
  import('./components/flow/flow-charts').then((m) => ({
    default: m.FlowCharts,
  }))
)

function LogStatCardsFallback() {
  return (
    <div className='grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3'>
      {LOG_STAT_CARD_FALLBACK_KEYS.map((key) => (
        <div
          key={key}
          className='bg-card overflow-hidden rounded-xl border p-2.5 shadow-xs sm:p-3'
        >
          <div className='flex items-center gap-1.5 sm:gap-2'>
            <Skeleton className='size-4 rounded-sm sm:size-7 sm:rounded-md' />
            <Skeleton className='h-4 w-16' />
          </div>
          <Skeleton className='mt-2 h-6 w-20 sm:h-7 sm:w-24' />
        </div>
      ))}
    </div>
  )
}

function ModelChartsFallback() {
  return (
    <div className='overflow-hidden rounded-lg border'>
      <div className='flex items-center justify-between border-b px-4 py-3 sm:px-5'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-8 w-72' />
      </div>
      <div className='h-96 p-2'>
        <Skeleton className='h-full w-full' />
      </div>
    </div>
  )
}

const SECTION_META: Record<DashboardSectionId, { titleKey: string }> = {
  overview: {
    titleKey: 'Overview',
  },
  models: {
    titleKey: 'Usage Analytics',
  },
  flow: {
    titleKey: 'Usage Flow',
  },
  users: {
    titleKey: 'User Analytics',
  },
}

export function Dashboard() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const params = route.useParams()
  const userRole = useAuthStore((state) => state.auth.user?.role)
  const activeSection = (params.section ??
    DASHBOARD_DEFAULT_SECTION) as DashboardSectionId

  // The title-bar switch. `all` is the platform-wide admin view, `self` makes
  // every panel behave exactly like it does for a regular user: the queries hit
  // the /self endpoints, the username filter disappears, and the admin-only
  // sections are dropped. A non-admin can never be in `all`, so the effective
  // scope is derived rather than trusted.
  const [viewScope, setViewScope] = useState<ViewScope>('all')
  const isAdmin = Boolean(userRole && userRole >= ROLE.ADMIN)
  const isAdminView = isAdmin && viewScope === 'all'

  const [chartPreferences, setChartPreferences] =
    useState<DashboardChartPreferences>(() => getSavedChartPreferences())
  const [modelFilters, setModelFilters] = useState<DashboardFilters>(() =>
    buildDefaultDashboardFilters(getSavedChartPreferences())
  )
  const [topUserLimit, setTopUserLimit] = useState(10)

  const userChartsFilters = useMemo<UserChartsFilters>(
    () => ({
      ...modelFilters,
      timeGranularity: modelFilters.time_granularity ?? getSavedGranularity(),
      topUserLimit,
    }),
    [modelFilters, topUserLimit]
  )
  const [flowSensitiveVisible, setFlowSensitiveVisible] = useState(true)

  const queryClient = useQueryClient()
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)

  const {
    data: modelData,
    isLoading: dataLoading,
    isFetching: dataFetching,
    refetch: refetchModelData,
    stats: modelStats,
  } = useDashboardData(modelFilters, isAdminView)

  const handleRefresh = useCallback(async () => {
    setIsManualRefreshing(true)
    try {
      // Advance every panel's window to the current instant first: the window
      // is otherwise frozen at mount so returning to the tab never refetches.
      refreshDashboardWindow()
      await Promise.all([
        refetchModelData(),
        queryClient.invalidateQueries({ queryKey: ['dashboard'] }),
      ])
    } finally {
      setIsManualRefreshing(false)
    }
  }, [queryClient, refetchModelData])

  const isRefreshing = dataFetching || isManualRefreshing

  // The site default granularity (Ops > Log maintenance) applies to every
  // browser that did not choose its own granularity on the dashboard. The
  // initial state above reads the cached status snapshot, and this effect
  // applies a refreshed value without requiring a reload.
  const statusQuery = useQuery(statusQueryOptions)
  useEffect(() => {
    const siteGranularity = readSiteDefaultTimeGranularity(statusQuery.data)
    if (!siteGranularity || hasLocalGranularityChoice()) return
    setChartPreferences((previous) =>
      previous.defaultTimeGranularity === siteGranularity
        ? previous
        : { ...previous, defaultTimeGranularity: siteGranularity }
    )
    setModelFilters((previous) =>
      previous.time_granularity === siteGranularity
        ? previous
        : { ...previous, time_granularity: siteGranularity }
    )
  }, [statusQuery.data])

  const handleFilterChange = useCallback((filters: DashboardFilters) => {
    setModelFilters(filters)
  }, [])

  const handleUserFiltersChange = useCallback(
    (filters: UserChartsFilters) => {
      if (
        filters.topUserLimit !== undefined &&
        filters.topUserLimit !== topUserLimit
      ) {
        setTopUserLimit(filters.topUserLimit)
      }
      setModelFilters((previous) => ({
        ...previous,
        preset: filters.preset,
        start_timestamp: filters.start_timestamp,
        end_timestamp: filters.end_timestamp,
        time_granularity: filters.time_granularity ?? filters.timeGranularity,
      }))
    },
    [topUserLimit]
  )

  const handleResetFilters = useCallback(() => {
    setModelFilters(buildDefaultDashboardFilters(chartPreferences))
  }, [chartPreferences])

  const visibleSections = useMemo(
    () =>
      DASHBOARD_SECTION_IDS.filter(
        (section) =>
          section !== 'overview' && (section !== 'users' || isAdminView)
      ),
    [isAdminView]
  )

  // Switching to "only mine" hides the user section, so a viewer standing on it
  // would be left on a section the tabs no longer offer. The username filter is
  // admin-only as well: it narrows *other* people's rows, so it is dropped with
  // the admin scope instead of silently surviving into the personal view.
  const handleViewScopeChange = useCallback(
    (scope: ViewScope) => {
      setViewScope(scope)
      if (scope === 'self') {
        setModelFilters((previous) =>
          previous.username === undefined
            ? previous
            : { ...previous, username: undefined }
        )
      }
      if (scope === 'self' && activeSection === 'users') {
        void navigate({
          to: '/dashboard/$section',
          params: { section: 'models' },
        })
      }
    },
    [activeSection, navigate]
  )

  const handleSectionChange = useCallback(
    (section: string) => {
      void navigate({
        to: '/dashboard/$section',
        params: { section: section as DashboardSectionId },
      })
    },
    [navigate]
  )

  const handleSelectUser = useCallback(
    (username: string) => {
      setModelFilters((prev) => ({
        ...prev,
        username,
      }))
      void navigate({
        to: '/dashboard/$section',
        params: { section: 'models' },
      })
    },
    [navigate]
  )

  if (activeSection === 'overview') {
    return <OverviewDashboard />
  }

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('Dashboard')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {isAdmin && (
          <ViewScopeToggle
            value={viewScope}
            onValueChange={handleViewScopeChange}
          />
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='space-y-3 sm:space-y-4'>
          <p className='text-muted-foreground -mt-1 text-xs sm:text-sm'>
            {t(
              'Monitor model consumption, call trends, token throughput, and routing flow.'
            )}
          </p>

          <DashboardToolbar
            currentFilters={modelFilters}
            onFilterChange={handleFilterChange}
            onResetFilters={handleResetFilters}
            onRefresh={handleRefresh}
            isRefreshing={isRefreshing}
            activeSection={activeSection}
            visibleSections={visibleSections}
            sectionMeta={SECTION_META}
            onSectionChange={handleSectionChange}
            isAdmin={isAdminView}
            chartPreferences={chartPreferences}
            flowSensitiveVisible={flowSensitiveVisible}
            onToggleFlowSensitive={() =>
              setFlowSensitiveVisible((prev) => !prev)
            }
          />
          {activeSection === 'models' && (
            <>
              <FadeIn>
                <Suspense fallback={<LogStatCardsFallback />}>
                  <LazyLogStatCards
                    stats={modelStats}
                    loading={dataLoading}
                    isAdminView={isAdminView}
                  />
                </Suspense>
              </FadeIn>
              <FadeIn delay={0.1}>
                <Suspense fallback={<ModelChartsFallback />}>
                  <LazyModelCharts
                    data={modelData}
                    loading={dataLoading}
                    timeGranularity={
                      modelFilters.time_granularity || DEFAULT_TIME_GRANULARITY
                    }
                  />
                </Suspense>
              </FadeIn>
              <FadeIn delay={0.15}>
                <Suspense fallback={<ModelChartsFallback />}>
                  <LazyModelBreakdownTable
                    data={modelData}
                    loading={dataLoading}
                  />
                </Suspense>
              </FadeIn>
            </>
          )}
          {activeSection === 'users' && isAdminView && (
            <FadeIn>
              <Suspense fallback={<ModelChartsFallback />}>
                <LazyUserCharts
                  filters={userChartsFilters}
                  onFiltersChange={handleUserFiltersChange}
                  onSelectUser={handleSelectUser}
                />
              </Suspense>
            </FadeIn>
          )}
          {activeSection === 'flow' && (
            <FadeIn>
              <Suspense fallback={<ModelChartsFallback />}>
                <LazyFlowCharts
                  filters={modelFilters}
                  sensitiveVisible={flowSensitiveVisible}
                  isAdminView={isAdminView}
                />
              </Suspense>
            </FadeIn>
          )}
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
