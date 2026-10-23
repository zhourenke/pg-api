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
import { Clock, Eye, EyeOff, Loader2, User as UserIcon, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { CompactDateTimeRangePicker } from '@/components/compact-date-time-range-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import {
  DEFAULT_TIME_GRANULARITY,
  TIME_GRANULARITY_OPTIONS,
} from '@/features/dashboard/constants'
import {
  cleanFilters,
  resolveDashboardWindow,
  saveGranularity,
} from '@/features/dashboard/lib'
import type { DashboardSectionId } from '@/features/dashboard/section-registry'
import type {
  DashboardChartPreferences,
  DashboardFilters,
} from '@/features/dashboard/types'
import { useDebouncedFilterChange } from '@/hooks/use-debounced-filter-change'
import type { TimeGranularity } from '@/lib/time'
import { DEFAULT_TIME_WINDOW_ID, type TimeWindowId } from '@/lib/time-window'

interface DashboardToolbarProps {
  currentFilters: DashboardFilters
  onFilterChange: (filters: DashboardFilters) => void
  onResetFilters: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  activeSection: DashboardSectionId
  visibleSections: DashboardSectionId[]
  sectionMeta: Record<DashboardSectionId, { titleKey: string }>
  onSectionChange: (section: string) => void
  isAdmin?: boolean
  chartPreferences?: DashboardChartPreferences
  flowSensitiveVisible?: boolean
  onToggleFlowSensitive?: () => void
}

export function DashboardToolbar(props: DashboardToolbarProps) {
  const { t } = useTranslation()
  const window = resolveDashboardWindow(props.currentFilters)

  const defaultPreset =
    props.chartPreferences?.defaultTimeWindowId ?? DEFAULT_TIME_WINDOW_ID
  const defaultGranularity =
    props.chartPreferences?.defaultTimeGranularity ?? DEFAULT_TIME_GRANULARITY

  const isCustomRange =
    !props.currentFilters.preset &&
    Boolean(
      props.currentFilters.start_timestamp && props.currentFilters.end_timestamp
    )

  const hasActiveFilters = Boolean(
    (props.currentFilters.preset &&
      props.currentFilters.preset !== defaultPreset) ||
    isCustomRange ||
    props.currentFilters.username ||
    (props.currentFilters.time_granularity &&
      props.currentFilters.time_granularity !== defaultGranularity)
  )

  const apply = (patch: Partial<DashboardFilters>) => {
    props.onFilterChange(cleanFilters({ ...props.currentFilters, ...patch }))
  }

  const handleDateTimeRangeChange = ({
    start,
    end,
    preset,
  }: {
    start?: Date
    end?: Date
    preset?: TimeWindowId
  }) => {
    if (preset) {
      apply({
        preset,
        start_timestamp: undefined,
        end_timestamp: undefined,
      })
    } else if (start && end) {
      const startTs = Math.floor(start.getTime() / 1000)
      const endTs = Math.floor(end.getTime() / 1000)
      apply({
        preset: undefined,
        start_timestamp: Math.min(startTs, endTs),
        end_timestamp: Math.max(startTs, endTs),
      })
    }
  }

  const handleGranularityChange = (granularity: TimeGranularity) => {
    saveGranularity(granularity)
    apply({ time_granularity: granularity })
  }

  const [usernameInput, setUsernameInput] = useState(
    props.currentFilters.username ?? ''
  )

  useEffect(() => {
    setUsernameInput(props.currentFilters.username ?? '')
  }, [props.currentFilters.username])

  const { change: debouncedChangeUsername, isPending: usernamePending } =
    useDebouncedFilterChange<string>((username) =>
      apply({ username: username.trim() || undefined })
    )

  const handleUsernameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    setUsernameInput(val)
    debouncedChangeUsername(val)
  }

  const handleClearUsername = () => {
    setUsernameInput('')
    apply({ username: undefined })
  }

  return (
    <div className='flex flex-col gap-3'>
      {/* Upper Navigation Row: Section Tabs */}
      {props.visibleSections.length > 1 && (
        <div className='flex items-center justify-between gap-2'>
          <Tabs
            value={props.activeSection}
            onValueChange={props.onSectionChange}
          >
            <TabsList className='max-w-full flex-wrap justify-start group-data-horizontal/tabs:h-auto'>
              {props.visibleSections.map((section) => (
                <TabsTrigger key={section} value={section}>
                  {t(props.sectionMeta[section].titleKey)}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      {/* Unified Filter Toolbar Card */}
      <div className='bg-card/50 rounded-lg border p-2.5 shadow-xs sm:p-3'>
        <div className='flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between'>
          {/* Primary Filters: Date-Time Range, Granularity, and Admin Username */}
          <div className='flex min-w-0 flex-1 flex-wrap items-center gap-2'>
            {/* Standard Compact DateTime Range Picker */}
            <div className='w-full min-w-0 sm:w-auto sm:min-w-[13.5rem]'>
              <CompactDateTimeRangePicker
                start={new Date(window.start * 1000)}
                end={new Date(window.end * 1000)}
                preset={props.currentFilters.preset}
                onChange={handleDateTimeRangeChange}
                className='h-8 text-sm'
              />
            </div>

            {/* Time Granularity Selector */}
            <div className='w-full min-w-0 sm:w-auto sm:min-w-[8.5rem]'>
              <Select
                items={TIME_GRANULARITY_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.label),
                }))}
                value={props.currentFilters.time_granularity ?? 'hour'}
                onValueChange={(val) =>
                  handleGranularityChange(val as TimeGranularity)
                }
              >
                <SelectTrigger
                  className='h-8 w-full gap-1.5 text-sm'
                  aria-label={t('Time Granularity')}
                >
                  <Clock className='text-muted-foreground size-3.5 shrink-0' />
                  <SelectValue placeholder={t('Time Granularity')} />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  <SelectGroup>
                    {TIME_GRANULARITY_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {t(opt.label)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            {/* Admin Username Search Filter */}
            {props.isAdmin && (
              <div className='relative w-full min-w-0 sm:w-44 md:w-52'>
                <UserIcon className='text-muted-foreground/60 pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2' />
                <Input
                  value={usernameInput}
                  onChange={handleUsernameChange}
                  placeholder={t('Filter by username')}
                  aria-label={t('Filter by username')}
                  className='h-8 pr-7 pl-8 text-sm'
                />
                {usernameInput && (
                  <button
                    type='button'
                    onClick={handleClearUsername}
                    className='hover:bg-muted text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-xs p-0.5'
                    aria-label={t('Clear username')}
                    title={t('Clear username')}
                  >
                    <X className='size-3' />
                  </button>
                )}
                {usernamePending && (
                  <span
                    aria-hidden='true'
                    className='bg-primary pointer-events-none absolute top-1/2 right-7 size-1.5 -translate-y-1/2 rounded-full'
                  />
                )}
              </div>
            )}

            {/* Non-Admin Active Username Filter Badge */}
            {!props.isAdmin && props.currentFilters.username && (
              <Badge
                variant='secondary'
                className='h-8 gap-1.5 px-2.5 text-xs font-normal'
              >
                <UserIcon className='text-muted-foreground size-3' />
                <span>{props.currentFilters.username}</span>
                <button
                  type='button'
                  onClick={handleClearUsername}
                  className='hover:bg-muted ml-0.5 rounded-xs p-0.5'
                  aria-label={t('Clear username')}
                >
                  <X className='size-2.5' />
                </button>
              </Badge>
            )}
          </div>

          {/* Action Buttons Cluster: Flow Sensitive Toggle, Reset, Refresh */}
          <div className='flex shrink-0 items-center justify-end gap-1.5 sm:gap-2'>
            {props.activeSection === 'flow' && props.onToggleFlowSensitive && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      type='button'
                      variant='ghost'
                      size='icon'
                      onClick={props.onToggleFlowSensitive}
                      aria-label={
                        props.flowSensitiveVisible
                          ? t('Hide sensitive data')
                          : t('Show sensitive data')
                      }
                      className='text-muted-foreground hover:text-foreground size-8'
                    >
                      {props.flowSensitiveVisible ? (
                        <Eye className='size-4' />
                      ) : (
                        <EyeOff className='size-4' />
                      )}
                    </Button>
                  }
                />
                <TooltipContent>
                  {props.flowSensitiveVisible
                    ? t('Hide sensitive data')
                    : t('Show sensitive data')}
                </TooltipContent>
              </Tooltip>
            )}

            <Button
              type='button'
              variant='outline'
              onClick={props.onResetFilters}
              disabled={!hasActiveFilters}
            >
              {t('Reset')}
            </Button>

            {props.onRefresh && (
              <Button
                type='button'
                onClick={props.onRefresh}
                disabled={props.isRefreshing}
              >
                {props.isRefreshing && <Loader2 className='animate-spin' />}
                {t('Refresh')}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
