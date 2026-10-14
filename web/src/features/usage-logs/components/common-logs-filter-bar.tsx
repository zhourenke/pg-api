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
import { useQueryClient, useIsFetching, useQuery } from '@tanstack/react-query'
import { useNavigate, getRouteApi } from '@tanstack/react-router'
import type { Table } from '@tanstack/react-table'
import { Eye, EyeOff } from 'lucide-react'
import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getGroups } from '@/features/users/api'
import { useDebouncedFilterChange } from '@/hooks/use-debounced-filter-change'
import { getUserGroups } from '@/lib/api'
import { requireServerSuccess } from '@/lib/server-error-message'
import {
  DEFAULT_TIME_WINDOW_ID,
  isTimeWindowStale,
  resolveTimeWindow,
  type TimeWindowId,
} from '@/lib/time-window'

import { LOG_TYPE_ALL_VALUE, LOG_TYPE_FILTERS } from '../constants'
import { buildSearchParams } from '../lib/filter'
import type { CommonLogFilters } from '../types'
import { CommonLogsStats } from './common-logs-stats'
import { CompactDateTimeRangePicker } from './compact-date-time-range-picker'
import {
  LogsFilterField,
  LogsFilterInput,
  LogsFilterToolbar,
} from './logs-filter-toolbar'
import { useLogsViewScope, useUsageLogsContext } from './usage-logs-provider'

const route = getRouteApi('/_authenticated/usage-logs/$section')

type LogTypeValue = (typeof LOG_TYPE_FILTERS)[number]['value']
const logTypeValueSet = new Set<string>(
  LOG_TYPE_FILTERS.map((type) => type.value)
)

type CommonLogDraft = {
  sourceKey: string
  filters: CommonLogFilters
  logType: LogTypeValue
}

function isLogTypeValue(value: string): value is LogTypeValue {
  return logTypeValueSet.has(value)
}

/**
 * The window a log page opens on: the trailing 24 hours from resolveTimeWindow
 * rather than "today 00:00 until now", which kept returning yesterday's rows
 * until the page was reloaded after midnight.
 */
function defaultWindow(): { start: Date; end: Date } {
  const window = resolveTimeWindow(DEFAULT_TIME_WINDOW_ID)
  return {
    start: new Date(window.start * 1000),
    end: new Date(window.end * 1000),
  }
}

function getLogTypeValue(value: unknown): LogTypeValue {
  return Array.isArray(value) &&
    value.length === 1 &&
    typeof value[0] === 'string' &&
    isLogTypeValue(value[0])
    ? value[0]
    : LOG_TYPE_ALL_VALUE
}

function buildSearchSourceKey(values: {
  startTime?: unknown
  endTime?: unknown
  preset?: unknown
  channel?: unknown
  model?: unknown
  token?: unknown
  group?: unknown
  username?: unknown
  requestId?: unknown
  upstreamRequestId?: unknown
  type?: unknown
}) {
  return [
    values.startTime,
    values.endTime,
    values.preset,
    values.channel,
    values.model,
    values.token,
    values.group,
    values.username,
    values.requestId,
    values.upstreamRequestId,
    Array.isArray(values.type) ? values.type.join(',') : values.type,
  ]
    .map((value) => String(value ?? ''))
    .join('\u001f')
}

interface CommonLogsFilterBarProps<TData> {
  table: Table<TData>
}

export function CommonLogsFilterBar<TData>(
  props: CommonLogsFilterBarProps<TData>
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const searchParams = route.useSearch()
  const { isAdminView: isAdmin } = useLogsViewScope()
  const { sensitiveVisible, setSensitiveVisible } = useUsageLogsContext()
  const fetchingLogs = useIsFetching({ queryKey: ['logs'] })
  const { data: adminGroups } = useQuery({
    queryKey: ['groups'],
    queryFn: async () => requireServerSuccess(await getGroups()),
    enabled: isAdmin,
  })
  const { data: userGroups } = useQuery({
    queryKey: ['user-groups'],
    queryFn: async () => requireServerSuccess(await getUserGroups()),
    enabled: !isAdmin,
  })
  const groupOptions = useMemo(() => {
    const groups = isAdmin
      ? (adminGroups?.data ?? [])
      : Object.keys(userGroups?.data ?? {})
    return groups
      .filter((group) => group !== 'auto')
      .map((group) => ({ label: group, value: group }))
  }, [isAdmin, adminGroups, userGroups])

  const searchState = useMemo<CommonLogDraft>(() => {
    const defaultRange = defaultWindow()
    const sourceValues = {
      startTime: searchParams.startTime,
      endTime: searchParams.endTime,
      preset: searchParams.preset,
      channel: searchParams.channel,
      model: searchParams.model,
      token: searchParams.token,
      group: searchParams.group,
      username: searchParams.username,
      requestId: searchParams.requestId,
      upstreamRequestId: searchParams.upstreamRequestId,
      type: searchParams.type,
    }
    const filters: CommonLogFilters = {
      startTime: searchParams.startTime
        ? new Date(searchParams.startTime)
        : defaultRange.start,
      endTime: searchParams.endTime
        ? new Date(searchParams.endTime)
        : defaultRange.end,
      preset: searchParams.preset,
      channel: searchParams.channel || undefined,
      model: searchParams.model || undefined,
      token: searchParams.token || undefined,
      group: searchParams.group || undefined,
      username: searchParams.username || undefined,
      requestId: searchParams.requestId || undefined,
      upstreamRequestId: searchParams.upstreamRequestId || undefined,
    }
    return {
      sourceKey: buildSearchSourceKey(sourceValues),
      filters,
      logType: getLogTypeValue(searchParams.type),
    }
  }, [
    searchParams.startTime,
    searchParams.endTime,
    searchParams.preset,
    searchParams.channel,
    searchParams.model,
    searchParams.token,
    searchParams.group,
    searchParams.username,
    searchParams.requestId,
    searchParams.upstreamRequestId,
    searchParams.type,
  ])
  const [draft, setDraft] = useState<CommonLogDraft>(() => searchState)
  const activeDraft =
    draft.sourceKey === searchState.sourceKey ? draft : searchState
  const filters = activeDraft.filters
  const logType = activeDraft.logType

  // The commit path is shared by every control and by the debounced text
  // fields, so it reads the current filters through refs instead of closing
  // over them: that keeps it stable, which the debounce hook requires, and it
  // still sees an edit that landed after the callback was created.
  const filtersRef = useRef(filters)
  filtersRef.current = filters
  const logTypeRef = useRef(logType)
  logTypeRef.current = logType
  const searchStateRef = useRef(searchState.sourceKey)
  searchStateRef.current = searchState.sourceKey

  /** Writes the filters to the URL, which is what makes the table refetch. */
  const commit = useCallback(
    (patch: Partial<CommonLogFilters>, nextLogType: LogTypeValue) => {
      const next = { ...filtersRef.current, ...patch }
      setDraft({
        sourceKey: searchStateRef.current,
        filters: next,
        logType: nextLogType,
      })
      navigate({
        to: '/usage-logs/$section',
        params: { section: 'common' },
        search: {
          ...buildSearchParams(next),
          type: [nextLogType],
          page: 1,
        },
      })
    },
    [navigate]
  )

  /** Re-pulls the current filters without touching them. */
  const handleSearch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['logs'] })
    queryClient.invalidateQueries({ queryKey: ['usage-logs-stats'] })
  }, [queryClient])

  const handleChange = useCallback(
    (
      field: keyof CommonLogFilters,
      value: Date | string | TimeWindowId | undefined
    ) => {
      commit({ [field]: value }, logTypeRef.current)
    },
    [commit]
  )

  const handleLogTypeChange = useCallback(
    (value: LogTypeValue) => {
      commit({}, value)
    },
    [commit]
  )

  // Typed text cannot apply on every keystroke, so those fields settle first
  // and then go through the same commit path as every other control.
  const {
    change: changeText,
    isPending: textPending,
    flush: flushText,
  } = useDebouncedFilterChange<Partial<CommonLogFilters>>((patch) => {
    commit(patch, logTypeRef.current)
  })

  // A calendar window such as "this week" is fixed in the URL until it is
  // rewritten, so a page opened yesterday would keep asking for yesterday's
  // week. Refresh it once per mount; `filters` changes again after that, but
  // the stored bounds then match and the effect stops.
  useEffect(() => {
    const window = {
      start: Math.floor((filters.startTime?.getTime() ?? 0) / 1000),
      end: Math.floor((filters.endTime?.getTime() ?? 0) / 1000),
    }
    if (!filters.preset || !isTimeWindowStale(filters.preset, window)) return

    const fresh = resolveTimeWindow(filters.preset)
    navigate({
      to: '/usage-logs/$section',
      params: { section: 'common' },
      search: {
        ...buildSearchParams(filters),
        type: [logType],
        startTime: fresh.start * 1000,
        endTime: fresh.end * 1000,
        preset: filters.preset,
        page: 1,
      },
      replace: true,
    })
  }, [filters, logType, navigate])

  const handleReset = useCallback(() => {
    const { start, end } = defaultWindow()
    commit(
      {
        startTime: start,
        endTime: end,
        preset: DEFAULT_TIME_WINDOW_ID,
        channel: undefined,
        model: undefined,
        token: undefined,
        group: undefined,
        username: undefined,
        requestId: undefined,
        upstreamRequestId: undefined,
      },
      LOG_TYPE_ALL_VALUE
    )
  }, [commit])

  // Enter commits the typed text right away instead of making the user wait
  // out the debounce.
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') flushText()
    },
    [flushText]
  )

  const hasExpandedFilters =
    !!filters.token ||
    !!filters.username ||
    !!filters.channel ||
    !!filters.requestId ||
    !!filters.upstreamRequestId

  const hasTypeFilter = logType !== LOG_TYPE_ALL_VALUE
  const hasAdditionalFilters =
    !!filters.model || !!filters.group || hasTypeFilter || hasExpandedFilters

  const expandedFilterCount = [
    filters.token,
    isAdmin ? filters.username : undefined,
    isAdmin ? filters.channel : undefined,
    filters.requestId,
    filters.upstreamRequestId,
  ].filter(Boolean).length
  const sensitiveInputClass = sensitiveVisible
    ? undefined
    : '[-webkit-text-security:disc]'
  const logTypeItems = useMemo(
    () =>
      LOG_TYPE_FILTERS.map((type) => ({
        value: type.value,
        label: t(type.label),
        deprecated: type.deprecated,
      })),
    [t]
  )
  const selectedLogType = logTypeItems.find((type) => type.value === logType)
  const deprecatedTypeDescription = t(
    'Only used to find historical logs. New records are available in Audit Logs.'
  )

  const statsBar = <CommonLogsStats />
  const sensitiveToggle = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant='ghost'
            size='icon'
            onClick={() => setSensitiveVisible(!sensitiveVisible)}
            aria-label={sensitiveVisible ? t('Hide') : t('Show')}
            className='text-muted-foreground hover:text-foreground size-7 max-sm:size-11'
          />
        }
      >
        {sensitiveVisible ? <Eye /> : <EyeOff />}
      </TooltipTrigger>
      <TooltipContent>
        {sensitiveVisible ? t('Hide') : t('Show')}
      </TooltipContent>
    </Tooltip>
  )

  const dateRangeFilter = (
    <LogsFilterField wide>
      <CompactDateTimeRangePicker
        start={filters.startTime}
        end={filters.endTime}
        preset={filters.preset}
        onChange={({ start, end, preset: nextPreset }) => {
          commit(
            { startTime: start, endTime: end, preset: nextPreset },
            logTypeRef.current
          )
        }}
      />
    </LogsFilterField>
  )
  const modelFilter = (
    <LogsFilterField>
      <LogsFilterInput
        placeholder={t('Model Name')}
        value={filters.model || ''}
        onChange={(e) => changeText({ model: e.target.value })}
        onKeyDown={handleKeyDown}
      />
    </LogsFilterField>
  )
  const groupFilter = (
    <LogsFilterField className={sensitiveInputClass}>
      <div className='relative min-w-0'>
        <Combobox
          options={groupOptions}
          allowCustomValue
          aria-label={t('Group')}
          emptyText={t('No group found.')}
          placeholder={t('Group')}
          className='h-8 min-w-0 text-sm leading-5'
          popupClassName={sensitiveInputClass}
          value={filters.group || ''}
          onValueChange={(value) => handleChange('group', value ?? '')}
          onKeyDown={handleKeyDown}
        />
        {textPending && (
          <span
            aria-hidden='true'
            className='bg-primary pointer-events-none absolute top-1/2 right-2 size-1.5 -translate-y-1/2 rounded-full'
          />
        )}
      </div>
    </LogsFilterField>
  )
  const typeFilter = (
    <LogsFilterField>
      <Select
        items={logTypeItems}
        value={logType}
        onValueChange={(value) => {
          handleLogTypeChange(
            value !== null && isLogTypeValue(value) ? value : LOG_TYPE_ALL_VALUE
          )
        }}
      >
        <SelectTrigger
          aria-label={t('Type')}
          aria-description={
            selectedLogType?.deprecated ? deprecatedTypeDescription : undefined
          }
        >
          <SelectValue className='min-w-0'>
            <span className='truncate'>
              {selectedLogType?.label ?? t('All Types')}
            </span>
            {selectedLogType?.deprecated && (
              <Badge
                variant='secondary'
                className='h-4 px-1.5 text-[10px] font-normal'
                title={deprecatedTypeDescription}
              >
                {t('Deprecated')}
              </Badge>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          alignItemWithTrigger={false}
          className='max-w-[calc(100vw-2rem)] min-w-52'
        >
          <SelectGroup>
            {LOG_TYPE_FILTERS.map((type) => (
              <SelectItem
                key={type.value}
                value={type.value}
                className='[&_[data-slot=select-item-text]]:items-center'
                aria-description={
                  type.deprecated ? deprecatedTypeDescription : undefined
                }
              >
                {t(type.label)}
                {type.deprecated && (
                  <Badge
                    variant='secondary'
                    className='h-4 px-1.5 text-[10px] font-normal'
                    title={deprecatedTypeDescription}
                  >
                    {t('Deprecated')}
                  </Badge>
                )}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </LogsFilterField>
  )
  const advancedFilters = (
    <>
      <LogsFilterField>
        <LogsFilterInput
          placeholder={t('Token Name')}
          className={sensitiveInputClass}
          value={filters.token || ''}
          onChange={(e) => changeText({ token: e.target.value })}
          onKeyDown={handleKeyDown}
        />
      </LogsFilterField>
      {isAdmin && (
        <LogsFilterField>
          <LogsFilterInput
            placeholder={t('Username')}
            className={sensitiveInputClass}
            value={filters.username || ''}
            onChange={(e) => changeText({ username: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </LogsFilterField>
      )}
      {isAdmin && (
        <LogsFilterField>
          <LogsFilterInput
            placeholder={t('Channel ID')}
            value={filters.channel || ''}
            onChange={(e) => changeText({ channel: e.target.value })}
            onKeyDown={handleKeyDown}
          />
        </LogsFilterField>
      )}
      <LogsFilterField>
        <LogsFilterInput
          placeholder={t('Request ID')}
          value={filters.requestId || ''}
          onChange={(e) => changeText({ requestId: e.target.value })}
          onKeyDown={handleKeyDown}
        />
      </LogsFilterField>
      <LogsFilterField>
        <LogsFilterInput
          placeholder={t('Upstream Request ID')}
          value={filters.upstreamRequestId || ''}
          onChange={(e) => changeText({ upstreamRequestId: e.target.value })}
          onKeyDown={handleKeyDown}
        />
      </LogsFilterField>
    </>
  )

  return (
    <LogsFilterToolbar
      table={props.table}
      compactMobile
      stats={statsBar}
      actionStart={sensitiveToggle}
      primaryFilters={
        <>
          {dateRangeFilter}
          {modelFilter}
          {groupFilter}
          {typeFilter}
        </>
      }
      advancedFilters={advancedFilters}
      mobilePinnedFilters={dateRangeFilter}
      mobileFilters={
        <>
          {modelFilter}
          {groupFilter}
          {typeFilter}
          {advancedFilters}
        </>
      }
      mobileFilterCount={
        [filters.model, filters.group, hasTypeFilter].filter(Boolean).length +
        expandedFilterCount
      }
      hasAdvancedActiveFilters={hasExpandedFilters}
      advancedFilterCount={expandedFilterCount}
      hasActiveFilters={hasAdditionalFilters}
      onSearch={handleSearch}
      searchLoading={fetchingLogs > 0}
      onReset={handleReset}
    />
  )
}
