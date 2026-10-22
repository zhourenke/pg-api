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
import {
  Calendar as CalendarIcon,
  ChevronDown,
  Eye,
  EyeOff,
  RefreshCw,
  RotateCcw,
  User as UserIcon,
  X,
} from 'lucide-react'
import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
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
import { TIME_GRANULARITY_OPTIONS } from '@/features/dashboard/constants'
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
import dayjs from '@/lib/dayjs'
import type { TimeGranularity } from '@/lib/time'
import { TIME_WINDOW_PRESETS, type TimeWindowId } from '@/lib/time-window'
import { cn } from '@/lib/utils'

import { ModelsChartPreferences } from '../models/models-chart-preferences'
import { ModelsFilter } from '../models/models-filter-dialog'

const PRIMARY_PRESET_IDS = new Set<TimeWindowId>([
  'today',
  '24h',
  '7d',
  '30d',
  'this-month',
])

const SECONDARY_PRESET_IDS = new Set<TimeWindowId>([
  'yesterday',
  'this-week',
  'last-week',
  'last-month',
])

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
  chartPreferences: DashboardChartPreferences
  onChartPreferencesChange: (preferences: DashboardChartPreferences) => void
  flowSensitiveVisible?: boolean
  onToggleFlowSensitive?: () => void
}

export function DashboardToolbar(props: DashboardToolbarProps) {
  const { t } = useTranslation()
  const [customRangeOpen, setCustomRangeOpen] = useState(false)
  const window = resolveDashboardWindow(props.currentFilters)

  const isCustomRange =
    !props.currentFilters.preset &&
    Boolean(
      props.currentFilters.start_timestamp && props.currentFilters.end_timestamp
    )

  const activePresetId = props.currentFilters.preset

  const primaryPresets = useMemo(
    () =>
      TIME_WINDOW_PRESETS.filter((preset) => PRIMARY_PRESET_IDS.has(preset.id)),
    []
  )

  const secondaryPresets = useMemo(
    () =>
      TIME_WINDOW_PRESETS.filter((preset) =>
        SECONDARY_PRESET_IDS.has(preset.id)
      ),
    []
  )

  const apply = (patch: Partial<DashboardFilters>) => {
    props.onFilterChange(cleanFilters({ ...props.currentFilters, ...patch }))
  }

  const handleSelectPreset = (presetId: TimeWindowId) => {
    apply({
      preset: presetId,
      start_timestamp: undefined,
      end_timestamp: undefined,
    })
  }

  const handleGranularityChange = (granularity: TimeGranularity) => {
    saveGranularity(granularity)
    apply({ time_granularity: granularity })
  }

  const handleCustomStartChange = (date: Date | undefined) => {
    if (!date) return
    const startTs = Math.floor(date.getTime() / 1000)
    const endTs = window.end
    apply({
      preset: undefined,
      start_timestamp: Math.min(startTs, endTs),
      end_timestamp: Math.max(startTs, endTs),
    })
  }

  const handleCustomEndChange = (date: Date | undefined) => {
    if (!date) return
    const endTs = Math.floor(date.getTime() / 1000)
    const startTs = window.start
    apply({
      preset: undefined,
      start_timestamp: Math.min(startTs, endTs),
      end_timestamp: Math.max(startTs, endTs),
    })
  }

  const handleClearUsername = () => {
    apply({ username: undefined })
  }

  const formattedDateRange = useMemo(() => {
    const startStr = dayjs(window.start * 1000).format('YYYY-MM-DD HH:mm')
    const endStr = dayjs(window.end * 1000).format('YYYY-MM-DD HH:mm')
    return `${startStr} ~ ${endStr}`
  }, [window.end, window.start])

  const hasActiveFilters = Boolean(
    isCustomRange || props.currentFilters.username
  )

  return (
    <div className='flex flex-col gap-2.5 sm:gap-3'>
      {/* Upper Navigation & Actions Bar */}
      <div className='flex flex-wrap items-center justify-between gap-2'>
        {props.visibleSections.length > 1 ? (
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
        ) : (
          <div />
        )}

        <div className='flex shrink-0 items-center gap-1.5 sm:gap-2'>
          {props.activeSection === 'flow' && props.onToggleFlowSensitive && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='sm'
                    onClick={props.onToggleFlowSensitive}
                    aria-label={
                      props.flowSensitiveVisible
                        ? t('Hide sensitive data')
                        : t('Show sensitive data')
                    }
                    className='h-8 gap-1.5 px-2.5 text-xs'
                  >
                    {props.flowSensitiveVisible ? (
                      <Eye className='size-3.5' />
                    ) : (
                      <EyeOff className='size-3.5' />
                    )}
                    <span className='hidden sm:inline'>
                      {props.flowSensitiveVisible
                        ? t('Hide sensitive data')
                        : t('Show sensitive data')}
                    </span>
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

          {props.activeSection === 'models' && (
            <>
              <ModelsChartPreferences
                preferences={props.chartPreferences}
                onPreferencesChange={props.onChartPreferencesChange}
              />
              <ModelsFilter
                currentFilters={props.currentFilters}
                onFilterChange={props.onFilterChange}
                onReset={props.onResetFilters}
                titleKey='Filter'
              />
            </>
          )}

          {props.onRefresh && (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant='outline'
                    size='icon'
                    onClick={props.onRefresh}
                    disabled={props.isRefreshing}
                    aria-label={t('Refresh')}
                    className='size-8'
                  >
                    <RefreshCw
                      className={cn(
                        'size-3.5',
                        props.isRefreshing && 'animate-spin'
                      )}
                    />
                  </Button>
                }
              />
              <TooltipContent>{t('Refresh')}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      {/* Persistent Filter & Granularity Control Strip */}
      <div className='bg-muted/40 flex flex-wrap items-center justify-between gap-2 rounded-xl border p-1.5 sm:p-2'>
        {/* Left: Quick Time Window Presets & Custom Range */}
        <div className='flex min-w-0 flex-wrap items-center gap-1 sm:gap-1.5'>
          <div className='flex items-center gap-1 overflow-x-auto py-0.5'>
            {primaryPresets.map((preset) => {
              const active = activePresetId === preset.id
              return (
                <Button
                  key={preset.id}
                  type='button'
                  size='sm'
                  variant={active ? 'default' : 'ghost'}
                  data-preset={preset.id}
                  onClick={() => handleSelectPreset(preset.id)}
                  className={cn(
                    'h-7 px-2.5 text-xs font-medium',
                    active
                      ? 'shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t(preset.labelKey)}
                </Button>
              )
            })}

            {/* Secondary presets dropdown */}
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant='ghost'
                    size='sm'
                    className={cn(
                      'h-7 gap-1 px-2 text-xs font-medium',
                      activePresetId && SECONDARY_PRESET_IDS.has(activePresetId)
                        ? 'bg-accent text-accent-foreground font-semibold'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <span>
                      {activePresetId &&
                      SECONDARY_PRESET_IDS.has(activePresetId)
                        ? t(
                            secondaryPresets.find(
                              (p) => p.id === activePresetId
                            )?.labelKey ?? 'More'
                          )
                        : t('More')}
                    </span>
                    <ChevronDown className='size-3 opacity-60' />
                  </Button>
                }
              />
              <PopoverContent className='w-40 p-1' align='start'>
                <div className='flex flex-col gap-0.5'>
                  {secondaryPresets.map((preset) => (
                    <Button
                      key={preset.id}
                      variant={
                        activePresetId === preset.id ? 'secondary' : 'ghost'
                      }
                      size='sm'
                      className='h-8 justify-start px-2.5 text-xs font-normal'
                      onClick={() => handleSelectPreset(preset.id)}
                    >
                      {t(preset.labelKey)}
                    </Button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>

            {/* Custom Range Popover */}
            <Popover open={customRangeOpen} onOpenChange={setCustomRangeOpen}>
              <PopoverTrigger
                render={
                  <Button
                    variant={isCustomRange ? 'default' : 'ghost'}
                    size='sm'
                    className={cn(
                      'h-7 gap-1 px-2.5 text-xs font-medium',
                      !isCustomRange &&
                        'text-muted-foreground hover:text-foreground'
                    )}
                  >
                    <CalendarIcon className='size-3' />
                    <span>{t('Custom Time Range')}</span>
                  </Button>
                }
              />
              <PopoverContent className='w-72 p-3 sm:w-80' align='start'>
                <div className='flex flex-col gap-3'>
                  <div className='text-xs font-semibold'>
                    {t('Custom Time Range')}
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <label className='text-muted-foreground text-[11px] font-medium'>
                      {t('Start Time')}
                    </label>
                    <DateTimePicker
                      value={new Date(window.start * 1000)}
                      onChange={handleCustomStartChange}
                      placeholder={t('Select start time')}
                    />
                  </div>
                  <div className='flex flex-col gap-1.5'>
                    <label className='text-muted-foreground text-[11px] font-medium'>
                      {t('End Time')}
                    </label>
                    <DateTimePicker
                      value={new Date(window.end * 1000)}
                      onChange={handleCustomEndChange}
                      placeholder={t('Select end time')}
                    />
                  </div>
                  <Button
                    size='sm'
                    className='mt-1 w-full'
                    onClick={() => setCustomRangeOpen(false)}
                  >
                    {t('Confirm')}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Right: Granularity, Active Filters & Range Display */}
        <div className='flex flex-wrap items-center gap-1.5 sm:gap-2'>
          {/* Active Range Tooltip / Display */}
          <div
            className='text-muted-foreground/80 hidden items-center gap-1.5 font-mono text-[11px] lg:flex'
            title={formattedDateRange}
          >
            <CalendarIcon className='size-3 shrink-0' />
            <span className='max-w-64 truncate'>{formattedDateRange}</span>
          </div>

          {/* Granularity Switcher */}
          <div className='flex items-center gap-1'>
            <span className='text-muted-foreground hidden text-[11px] font-medium sm:inline'>
              {t('Time Granularity')}:
            </span>
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
              <SelectTrigger className='h-7 min-w-20 px-2 text-xs'>
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

          {/* Active Filter Badges & Reset Button */}
          {hasActiveFilters && (
            <div className='flex items-center gap-1'>
              {props.currentFilters.username && (
                <Badge
                  variant='secondary'
                  className='h-6 gap-1 px-1.5 text-[11px]'
                >
                  <UserIcon className='size-2.5' />
                  <span>{props.currentFilters.username}</span>
                  <button
                    type='button'
                    onClick={handleClearUsername}
                    className='hover:bg-muted ml-0.5 rounded-xs p-0.5'
                    aria-label={t('Reset')}
                  >
                    <X className='size-2.5' />
                  </button>
                </Badge>
              )}

              <Button
                variant='ghost'
                size='sm'
                onClick={props.onResetFilters}
                className='text-muted-foreground hover:text-foreground h-7 gap-1 px-2 text-xs'
                title={t('Reset')}
              >
                <RotateCcw className='size-3' />
                <span className='hidden sm:inline'>{t('Reset')}</span>
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
