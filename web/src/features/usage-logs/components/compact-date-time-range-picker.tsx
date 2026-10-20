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
import { CalendarDays } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import dayjs from '@/lib/dayjs'
import {
  matchTimeWindowPreset,
  resolveTimeWindow,
  TIME_WINDOW_PRESETS,
  toTimeWindow,
  type TimeWindow,
  type TimeWindowId,
} from '@/lib/time-window'
import { cn } from '@/lib/utils'

interface CompactDateTimeRangePickerProps {
  start?: Date
  end?: Date
  /** The preset the current range came from; absent when it was hand-picked. */
  preset?: TimeWindowId
  onChange: (range: { start?: Date; end?: Date; preset?: TimeWindowId }) => void
  className?: string
}

/**
 * The stored id is the viewer's own choice and names the window even after its
 * bounds have aged: a rolling window is a second older the moment it is written,
 * so re-deriving the label from the clock would turn "24 Hours" into a pair of
 * timestamps on the next render. Only a range that arrives without an id — a
 * hand-picked one — has to be matched against the presets.
 */
function resolvePreset(
  preset: TimeWindowId | undefined,
  window: TimeWindow
): TimeWindowId | null {
  return preset ?? matchTimeWindowPreset(window)
}

function toInputValue(date?: Date): string {
  return date ? dayjs(date).format('YYYY-MM-DDTHH:mm') : ''
}

function fromInputValue(value: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function CompactDateTimeRangePicker({
  start,
  end,
  preset,
  onChange,
  className,
}: CompactDateTimeRangePickerProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [draftStart, setDraftStart] = useState(toInputValue(start))
  const [draftEnd, setDraftEnd] = useState(toInputValue(end))
  // A hand-picked range is the one thing the preset id cannot describe, so the
  // popover tracks it separately from the presets it can.
  const [customRange, setCustomRange] = useState(false)

  const selectedPreset = useMemo(
    () =>
      resolvePreset(
        preset,
        toTimeWindow(start ?? new Date(), end ?? new Date())
      ),
    [end, preset, start]
  )
  const activePreset = start || end ? selectedPreset : null

  const label = useMemo(() => {
    if (!start && !end) return t('Date Range')
    const presetLabel = TIME_WINDOW_PRESETS.find(
      (item) => item.id === selectedPreset
    )
    if (presetLabel) return t(presetLabel.labelKey)
    // The popover's <input type="datetime-local"> only supports minute
    // precision, so seconds are always 00 (manual pick) or 59 (preset
    // end-of-day). Hide them in the trigger label to keep the button
    // width compact while still showing the meaningful timestamp.
    const startText = start ? dayjs(start).format('YYYY-MM-DD HH:mm') : '-'
    const endText = end ? dayjs(end).format('YYYY-MM-DD HH:mm') : '-'
    return `${startText} ~ ${endText}`
  }, [end, selectedPreset, start, t])

  const mobileLabel = useMemo(() => {
    if (selectedPreset) return label
    if (!start || !end) return label
    if (dayjs(start).isSame(end, 'day')) {
      return `${dayjs(start).format('MM/DD HH:mm')}–${dayjs(end).format('HH:mm')}`
    }
    return label
  }, [start, end, label, selectedPreset])

  const handleOpenChange = (nextOpen: boolean) => {
    if (nextOpen) {
      setDraftStart(toInputValue(start))
      setDraftEnd(toInputValue(end))
      setCustomRange(!selectedPreset && Boolean(start || end))
    }
    setOpen(nextOpen)
  }

  const applyDraft = () => {
    onChange({
      start: fromInputValue(draftStart),
      end: fromInputValue(draftEnd),
    })
    setOpen(false)
  }

  const applyPreset = (id: TimeWindowId) => {
    const window = resolveTimeWindow(id)
    const range = {
      start: new Date(window.start * 1000),
      end: new Date(window.end * 1000),
    }
    setDraftStart(toInputValue(range.start))
    setDraftEnd(toInputValue(range.end))
    setCustomRange(false)
    onChange({ ...range, preset: id })
    setOpen(false)
  }

  const openCustomRange = () => {
    setCustomRange(true)
    setDraftStart(toInputValue(start))
    setDraftEnd(toInputValue(end))
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <Button
            type='button'
            variant='outline'
            aria-label={label}
            className={cn(
              'w-full justify-start gap-2 px-2.5 text-sm leading-5 font-normal tabular-nums',
              !start && !end && 'text-muted-foreground',
              className
            )}
          />
        }
      >
        <CalendarDays className='text-muted-foreground size-4 shrink-0' />
        <span className='hidden truncate sm:block'>{label}</span>
        <span className='min-w-0 [overflow-wrap:anywhere] whitespace-normal sm:hidden'>
          {mobileLabel}
        </span>
      </PopoverTrigger>
      <PopoverContent
        align='start'
        className='w-[min(420px,calc(100vw-2rem))] p-3'
      >
        <div className='space-y-3'>
          <div
            role='group'
            aria-label={t('Time range')}
            className='grid grid-cols-3 gap-1.5'
          >
            {TIME_WINDOW_PRESETS.map((item) => (
              <Button
                key={item.id}
                type='button'
                data-preset={item.id}
                variant={activePreset === item.id ? 'default' : 'secondary'}
                size='sm'
                aria-pressed={activePreset === item.id}
                className='h-7 w-auto px-2 text-xs whitespace-nowrap'
                onClick={() => applyPreset(item.id)}
              >
                {t(item.labelKey)}
              </Button>
            ))}
            <Button
              type='button'
              variant={customRange ? 'default' : 'outline'}
              size='sm'
              aria-pressed={customRange}
              className='col-span-3 h-7 w-auto px-2 text-xs whitespace-nowrap'
              onClick={openCustomRange}
            >
              {t('Custom')}
            </Button>
          </div>

          {customRange && (
            <>
              <div className='grid gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-end'>
                <div className='space-y-1.5'>
                  <div className='text-muted-foreground text-xs'>
                    {t('Start Time')}
                  </div>
                  <Input
                    type='datetime-local'
                    value={draftStart}
                    aria-label={t('Start Time')}
                    onChange={(e) => setDraftStart(e.target.value)}
                    className='h-8 text-sm leading-5 tabular-nums'
                  />
                </div>
                <span className='text-muted-foreground hidden pb-2 text-xs sm:block'>
                  ~
                </span>
                <div className='space-y-1.5'>
                  <div className='text-muted-foreground text-xs'>
                    {t('End Time')}
                  </div>
                  <Input
                    type='datetime-local'
                    value={draftEnd}
                    aria-label={t('End Time')}
                    onChange={(e) => setDraftEnd(e.target.value)}
                    className='h-8 text-sm leading-5 tabular-nums'
                  />
                </div>
              </div>

              <div className='flex justify-end'>
                <Button size='sm' className='h-8' onClick={applyDraft}>
                  {t('Confirm')}
                </Button>
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
