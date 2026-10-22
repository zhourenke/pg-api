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
import { User, X } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import type { FlowUserFilterOption } from '@/features/dashboard/types'

export interface FlowUserFilterControlProps {
  metricLabel: string
  formatMetricValue: (value: number) => string
  options: FlowUserFilterOption[]
  selectedUsers: string[]
  onToggleUser: (userId: string) => void
  onRemoveUser: (userId: string) => void
  onClearUsers: () => void
}

export function FlowUserFilterControl(props: FlowUserFilterControlProps) {
  const { t } = useTranslation()
  const selectedSet = useMemo(
    () => new Set(props.selectedUsers),
    [props.selectedUsers]
  )
  const optionMap = useMemo(() => {
    const map = new Map<string, FlowUserFilterOption>()
    for (const option of props.options) {
      map.set(option.value, option)
    }
    return map
  }, [props.options])

  const selectedOptions = props.selectedUsers.map((value) => ({
    value,
    label: optionMap.get(value)?.label ?? value,
  }))
  const selectedCount = selectedOptions.length

  return (
    <div className='flex min-w-0 flex-col gap-1.5'>
      <span className='text-muted-foreground text-xs font-medium'>
        {t('User filters')}
      </span>
      <div className='flex min-w-0 flex-wrap items-center gap-1.5'>
        <Popover>
          <PopoverTrigger
            render={
              <Button
                type='button'
                variant='outline'
                size='sm'
                aria-label={t('Filter by user')}
              />
            }
          >
            <User data-icon='inline-start' aria-hidden='true' />
            {selectedCount > 0 ? t('Selected users') : t('All users')}
            {selectedCount > 0 && (
              <Badge variant='secondary' className='rounded-sm px-1'>
                {selectedCount}
              </Badge>
            )}
          </PopoverTrigger>
          <PopoverContent
            className='w-[min(28rem,calc(100vw-2rem))] p-0'
            align='start'
          >
            <PopoverHeader className='px-3 pt-3'>
              <PopoverTitle>{t('User filters')}</PopoverTitle>
              <PopoverDescription>
                {t('Value metric')}: {props.metricLabel}
              </PopoverDescription>
            </PopoverHeader>
            <Command>
              <CommandInput placeholder={t('Filter by user')} />
              <CommandList>
                <CommandEmpty>{t('No users')}</CommandEmpty>
                <CommandGroup>
                  {props.options.map((option) => {
                    const metricValueLabel = props.formatMetricValue(
                      option.valueRaw
                    )
                    const isChecked = selectedSet.has(option.value)
                    return (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${props.metricLabel} ${metricValueLabel}`}
                        data-checked={isChecked}
                        onSelect={() => props.onToggleUser(option.value)}
                      >
                        <span
                          className='size-2.5 shrink-0 rounded-full'
                          style={{ backgroundColor: option.color }}
                          aria-hidden='true'
                        />
                        <span className='min-w-0 flex-1 truncate'>
                          {option.label}
                        </span>
                        <span className='text-muted-foreground flex shrink-0 items-center gap-1 text-xs'>
                          <span>{props.metricLabel}</span>
                          <span className='font-mono'>{metricValueLabel}</span>
                        </span>
                      </CommandItem>
                    )
                  })}
                </CommandGroup>
                {selectedCount > 0 && (
                  <>
                    <CommandSeparator />
                    <CommandGroup>
                      <CommandItem
                        onSelect={props.onClearUsers}
                        className='justify-center text-center'
                      >
                        {t('Clear user filters')}
                      </CommandItem>
                    </CommandGroup>
                  </>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {selectedOptions.map((option) => (
          <Badge
            key={option.value}
            variant='secondary'
            className='max-w-[14rem] rounded-sm pr-1'
          >
            <span className='truncate'>{option.label}</span>
            <button
              type='button'
              className='hover:bg-muted-foreground/15 flex size-4 shrink-0 items-center justify-center rounded-sm'
              aria-label={t('Remove user filter')}
              onClick={() => props.onRemoveUser(option.value)}
            >
              <X aria-hidden='true' />
            </button>
          </Badge>
        ))}

        {selectedCount > 1 && (
          <Button
            type='button'
            variant='ghost'
            size='xs'
            onClick={props.onClearUsers}
          >
            {t('Clear')}
          </Button>
        )}
      </div>
    </div>
  )
}
