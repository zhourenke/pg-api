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
import {
  Activity,
  ChevronRight,
  EyeOff,
  GitBranch,
  Hash,
  Info,
  WalletCards,
} from 'lucide-react'
import { Fragment, useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { IconBadge } from '@/components/ui/icon-badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getFlowQuotaDates } from '@/features/dashboard/api'
import { useDashboardWindow } from '@/features/dashboard/hooks/use-dashboard-window'
import { buildQueryParams, getFlowStages } from '@/features/dashboard/lib'
import { requireSuccessfulFlowRows } from '@/features/dashboard/lib/flow-selection'
import type {
  DashboardFilters,
  FlowMetric,
  FlowNodeKind,
  FlowRole,
} from '@/features/dashboard/types'
import { formatQuota } from '@/lib/format'
import { ROLE } from '@/lib/roles'
import { requireServerSuccess } from '@/lib/server-error-message'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

import { FlowBreakdown } from './flow-breakdown'

interface FlowChartsProps {
  filters?: DashboardFilters
  // When false, sensitive node labels are masked in the rendered breakdown.
  sensitiveVisible?: boolean
  // The effective scope picked in the page title bar: `self` renders the
  // personal flow and queries /api/data/flow/self even for an admin account.
  isAdminView?: boolean
}

const FLOW_METRIC_OPTIONS = [
  { value: 'quota', labelKey: 'By quota', icon: WalletCards },
  { value: 'tokens', labelKey: 'By tokens', icon: Hash },
  { value: 'requests', labelKey: 'By requests', icon: Activity },
] as const

const FLOW_TOP_LIMIT_OPTIONS = [10, 20, 50, 100] as const

const DEFAULT_FLOW_TOP_NODE_LIMIT = 50

// At least two dimensions are needed for the breakdown to say anything.
const MIN_VISIBLE_STAGES = 2

const FLOW_STAGE_META: Record<
  FlowNodeKind,
  { labelKey: string; descKey: string }
> = {
  user: {
    labelKey: 'User',
    descKey: 'The user who made the requests',
  },
  node: {
    labelKey: 'Node',
    descKey: 'The deployment node that handled the requests',
  },
  token: {
    labelKey: 'Token',
    descKey: 'The API key used for the requests',
  },
  group: {
    labelKey: 'Group',
    descKey: 'The user group applied to the requests',
  },
  model: {
    labelKey: 'Model',
    descKey: 'The model that was requested',
  },
  channel: {
    labelKey: 'Channel',
    descKey: 'The upstream channel that served the requests',
  },
}

const FLOW_STAGE_LABEL_KEYS: Record<FlowNodeKind, string> = {
  user: FLOW_STAGE_META.user.labelKey,
  node: FLOW_STAGE_META.node.labelKey,
  token: FLOW_STAGE_META.token.labelKey,
  group: FLOW_STAGE_META.group.labelKey,
  model: FLOW_STAGE_META.model.labelKey,
  channel: FLOW_STAGE_META.channel.labelKey,
}

function formatFlowMetricNumber(value: number): string {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value
  )
}

export function FlowCharts(props: FlowChartsProps) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  // The flow role follows the scope chosen in the title bar, not just the
  // account: an admin who switched to "only mine" gets the personal breakdown
  // and the /self endpoint, so the graph cannot leak other users' names.
  const isAdmin = Boolean(props.isAdminView)
  let flowRole: FlowRole = 'user'
  if (isAdmin) {
    flowRole = user?.role && user.role >= ROLE.SUPER_ADMIN ? 'root' : 'admin'
  }
  const [metric, setMetric] = useState<FlowMetric>('quota')
  const [topNodeLimit, setTopNodeLimit] = useState(DEFAULT_FLOW_TOP_NODE_LIMIT)
  const [hiddenStages, setHiddenStages] = useState<FlowNodeKind[]>([])

  const stages = useMemo(() => getFlowStages(flowRole), [flowRole])
  const visibleStages = useMemo(
    () => stages.filter((stage) => !hiddenStages.includes(stage)),
    [stages, hiddenStages]
  )
  const toggleStage = (stage: FlowNodeKind) => {
    setHiddenStages((prev) => {
      const hidden = new Set(prev)
      if (hidden.has(stage)) {
        hidden.delete(stage)
      } else {
        const remaining = stages.filter((item) => !hidden.has(item)).length
        if (remaining <= MIN_VISIBLE_STAGES) return prev
        hidden.add(stage)
      }
      return stages.filter((item) => hidden.has(item))
    })
  }

  const dashboardWindow = useDashboardWindow(props.filters)
  const flowQueryParams = useMemo(
    () => buildQueryParams(dashboardWindow, props.filters),
    [props.filters, dashboardWindow]
  )

  const {
    data: flowRows,
    error: flowError,
    isError,
    isLoading,
  } = useQuery({
    queryKey: ['dashboard', 'flow', flowQueryParams, flowRole],
    queryFn: async () =>
      requireServerSuccess(await getFlowQuotaDates(flowQueryParams, isAdmin)),
    select: (res) =>
      requireSuccessfulFlowRows(res, t('Please try again later.')),
    staleTime: 60_000,
  })

  const maskSensitive = props.sensitiveVisible === false
  const formatNodeMetricValue = useCallback(
    (value: number) =>
      metric === 'quota' ? formatQuota(value) : formatFlowMetricNumber(value),
    [metric]
  )
  const flowErrorMessage =
    flowError instanceof Error
      ? flowError.message
      : t('Please try again later.')
  const chartTitle = t('Flow')

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex min-w-0 flex-wrap items-end gap-2'>
        <div className='flex min-w-0 flex-col gap-1.5'>
          <div className='flex items-center gap-1.5'>
            <span className='text-muted-foreground text-xs font-medium'>
              {t('Flow width metric')}
            </span>
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      className='text-muted-foreground/60 hover:text-foreground flex size-5 shrink-0 items-center justify-center rounded-md'
                      aria-label={t('Flow width metric')}
                    />
                  }
                >
                  <Info className='size-3.5' />
                </TooltipTrigger>
                <TooltipContent className='max-w-[14rem]'>
                  {t('Choose how flow widths are calculated.')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
          <Tabs
            value={metric}
            onValueChange={(value) => setMetric(value as FlowMetric)}
            className='shrink-0'
          >
            <TabsList aria-label={t('Flow width metric')}>
              {FLOW_METRIC_OPTIONS.map((option) => {
                const Icon = option.icon
                return (
                  <TabsTrigger
                    key={option.value}
                    value={option.value}
                    className='gap-1.5 px-2.5 text-xs'
                  >
                    <Icon data-icon='inline-start' aria-hidden='true' />
                    {t(option.labelKey)}
                  </TabsTrigger>
                )
              })}
            </TabsList>
          </Tabs>
        </div>

        <div className='flex min-w-0 flex-col gap-1.5'>
          <span className='text-muted-foreground text-xs font-medium'>
            {t('Display limit')}
          </span>
          <Tabs
            value={String(topNodeLimit)}
            onValueChange={(value) => setTopNodeLimit(Number(value))}
            className='shrink-0'
          >
            <TabsList aria-label={t('Display limit')}>
              {FLOW_TOP_LIMIT_OPTIONS.map((limit) => (
                <TabsTrigger
                  key={limit}
                  value={String(limit)}
                  className='px-2.5 text-xs'
                >
                  {t('Top {{count}}', { count: limit })}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className='overflow-hidden rounded-lg border'>
        <div className='flex w-full flex-col gap-2 border-b px-3 py-2 sm:px-5 sm:py-3 lg:flex-row lg:items-center lg:justify-between'>
          <div className='flex min-w-0 items-center gap-2'>
            <IconBadge tone='info' size='sm'>
              <GitBranch />
            </IconBadge>
            <div className='text-sm font-semibold'>{chartTitle}</div>
          </div>
          <TooltipProvider>
            <div className='flex min-w-0 items-center gap-1 overflow-x-auto pb-1 lg:justify-end lg:pb-0'>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type='button'
                      className='text-muted-foreground/60 hover:text-foreground flex size-6 shrink-0 items-center justify-center rounded-md'
                      aria-label={t('Show or hide flow columns')}
                    />
                  }
                >
                  <Info className='size-3.5' />
                </TooltipTrigger>
                <TooltipContent className='max-w-[16rem]'>
                  {t('Click a stage to show or hide that column')}
                </TooltipContent>
              </Tooltip>
              {stages.map((stage, index) => {
                const meta = FLOW_STAGE_META[stage]
                const visible = !hiddenStages.includes(stage)
                return (
                  <Fragment key={stage}>
                    {index > 0 && (
                      <ChevronRight className='text-muted-foreground/40 size-3.5 shrink-0' />
                    )}
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Toggle
                            variant='outline'
                            size='sm'
                            pressed={visible}
                            onPressedChange={() => toggleStage(stage)}
                            aria-label={t(meta.labelKey)}
                            className={cn('shrink-0', !visible && 'opacity-50')}
                          />
                        }
                      >
                        {!visible && <EyeOff className='size-3' />}
                        {t(meta.labelKey)}
                      </TooltipTrigger>
                      <TooltipContent>{t(meta.descKey)}</TooltipContent>
                    </Tooltip>
                  </Fragment>
                )
              })}
            </div>
          </TooltipProvider>
        </div>
        <div className='p-3 sm:p-4'>
          <FlowBreakdown
            rows={flowRows ?? []}
            metric={metric}
            role={flowRole}
            stages={visibleStages}
            topLimit={topNodeLimit}
            loading={isLoading}
            errorMessage={isError ? flowErrorMessage : null}
            maskSensitive={maskSensitive}
            stageLabels={FLOW_STAGE_LABEL_KEYS}
            formatMetricValue={formatNodeMetricValue}
          />
        </div>
      </div>
    </div>
  )
}
