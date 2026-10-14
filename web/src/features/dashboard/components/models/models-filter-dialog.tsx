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
import { Filter, RotateCcw, Calendar } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { DateTimePicker } from '@/components/datetime-picker'
import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { TIME_GRANULARITY_OPTIONS } from '@/features/dashboard/constants'
import { cleanFilters, resolveDashboardWindow } from '@/features/dashboard/lib'
import type { DashboardFilters } from '@/features/dashboard/types'
import { useDebouncedFilterChange } from '@/hooks/use-debounced-filter-change'
import type { TimeGranularity } from '@/lib/time'
import { TIME_WINDOW_PRESETS, type TimeWindowId } from '@/lib/time-window'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

interface ModelsFilterProps {
  // The window the dashboard is querying with. Every control writes straight
  // through to it, so the dialog never holds a draft that could go out of sync.
  currentFilters: DashboardFilters
  onFilterChange: (filters: DashboardFilters) => void
  onReset: () => void
  titleKey?: string
  descriptionKey?: string
}

/**
 * Section divider component for better visual organization
 */
const SectionDivider = ({ label }: { label: string }) => (
  <div className='relative'>
    <div className='absolute inset-0 flex items-center'>
      <span className='w-full border-t' />
    </div>
    <div className='relative flex justify-center text-xs uppercase'>
      <span className='bg-background text-muted-foreground px-2'>{label}</span>
    </div>
  </div>
)

export function ModelsFilter(props: ModelsFilterProps) {
  const { t } = useTranslation()
  // 使用已缓存的用户数据，避免重复调用 API
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = user?.role && user.role >= 10

  const [open, setOpen] = useState(false)
  // Picking a preset drops the stored bounds: the preset is resolved when the
  // window is needed, which is what keeps a calendar window from going stale.
  const window = resolveDashboardWindow(props.currentFilters)

  const apply = (patch: Partial<DashboardFilters>) => {
    props.onFilterChange(cleanFilters({ ...props.currentFilters, ...patch }))
  }

  // Typed text cannot apply on every keystroke, unlike the other controls.
  const { change: changeUsername, isPending: usernamePending } =
    useDebouncedFilterChange<string>((username) => apply({ username }))

  const handlePreset = (preset: TimeWindowId) => {
    apply({
      preset,
      start_timestamp: undefined,
      end_timestamp: undefined,
    })
  }

  const handleBoundChange = (
    field: 'start_timestamp' | 'end_timestamp',
    date: Date | undefined
  ) => {
    if (!date) return
    // A hand-picked bound makes the range custom, so the preset goes away and
    // both bounds are stored explicitly.
    apply({
      preset: undefined,
      start_timestamp:
        field === 'start_timestamp'
          ? Math.floor(date.getTime() / 1000)
          : window.start,
      end_timestamp:
        field === 'end_timestamp'
          ? Math.floor(date.getTime() / 1000)
          : window.end,
    })
  }

  const handleReset = () => {
    props.onReset()
    setOpen(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button variant='outline' size='sm'>
          <Filter className='mr-2 h-4 w-4' />
          {t('Filter')}
        </Button>
      }
      title={t(props.titleKey ?? 'Model Analytics Filters')}
      description={t(
        props.descriptionKey ??
          'Filter the model analytics view by time range and user.'
      )}
      contentClassName='max-sm:h-dvh max-sm:w-screen max-sm:max-w-none max-sm:rounded-none max-sm:p-4 sm:max-w-lg'
      contentHeight='min(48vh, 460px)'
      footer={
        <Button onClick={handleReset} variant='outline' type='button'>
          <RotateCcw className='mr-2 h-4 w-4' />
          {t('Reset')}
        </Button>
      }
    >
      <ScrollArea className='h-full pr-3 sm:pr-4'>
        <div className='grid gap-2.5 py-2'>
          {/* Quick time range selection */}
          <div className='grid gap-2'>
            <Label className='flex items-center gap-2'>
              <Calendar className='h-4 w-4' />
              {t('Quick Range')}
            </Label>
            <div className='flex flex-wrap gap-2'>
              {TIME_WINDOW_PRESETS.map((preset) => {
                const active = props.currentFilters.preset === preset.id

                return (
                  <Button
                    key={preset.id}
                    type='button'
                    size='sm'
                    variant={active ? 'default' : 'outline'}
                    aria-pressed={active}
                    data-preset={preset.id}
                    onClick={() => handlePreset(preset.id)}
                    className={cn(
                      'flex-1',
                      active && 'ring-ring ring-2 ring-offset-2'
                    )}
                  >
                    {t(preset.labelKey)}
                  </Button>
                )
              })}
            </div>
          </div>

          <SectionDivider label={t('Custom Time Range')} />

          {/* Custom time range */}
          <div className='grid gap-2.5'>
            <div className='grid gap-2'>
              <Label htmlFor='start_timestamp'>{t('Start Time')}</Label>
              <DateTimePicker
                value={new Date(window.start * 1000)}
                onChange={(date) => handleBoundChange('start_timestamp', date)}
                placeholder={t('Select start time')}
              />
            </div>

            <div className='grid gap-2'>
              <Label htmlFor='end_timestamp'>{t('End Time')}</Label>
              <DateTimePicker
                value={new Date(window.end * 1000)}
                onChange={(date) => handleBoundChange('end_timestamp', date)}
                placeholder={t('Select end time')}
              />
            </div>
          </div>

          <SectionDivider label={t('Chart Settings')} />

          <div className='grid gap-2'>
            <Label htmlFor='time_granularity'>{t('Time Granularity')}</Label>
            <Select
              items={TIME_GRANULARITY_OPTIONS.map((option) => ({
                value: option.value,
                label: t(option.label),
              }))}
              value={props.currentFilters.time_granularity}
              onValueChange={(value) =>
                apply({ time_granularity: value as TimeGranularity })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder={t('Select time granularity')} />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                <SelectGroup>
                  {TIME_GRANULARITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {t(option.label)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          {/* Admin-only fields */}
          {isAdmin && (
            <>
              <SectionDivider label={t('Admin Only')} />

              <div className='grid gap-2'>
                <Label htmlFor='username'>{t('Username')}</Label>
                <div className='relative'>
                  <Input
                    id='username'
                    placeholder={t('Filter by username')}
                    value={props.currentFilters.username ?? ''}
                    onChange={(e) => changeUsername(e.target.value)}
                  />
                  {usernamePending && (
                    <span
                      aria-hidden='true'
                      className='bg-primary pointer-events-none absolute top-1/2 right-2 size-1.5 -translate-y-1/2 rounded-full'
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </Dialog>
  )
}
