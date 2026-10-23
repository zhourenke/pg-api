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
import { ArrowDown, ArrowUp, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export type DataTableSortDirection = 'asc' | 'desc'

export type DataTableSortOption<TValue extends string> = {
  value: TValue
  label: string
}

type DataTableSortMenuProps<TValue extends string> = {
  /** The columns this table can be sorted by, in menu order. */
  options: readonly DataTableSortOption<TValue>[]
  value: TValue
  onValueChange: (value: TValue) => void
  direction: DataTableSortDirection
  onDirectionChange: (direction: DataTableSortDirection) => void
  className?: string
}

/**
 * Sort control of the model square: a dropdown that names the field the table is
 * ordered by, and a button that flips the direction.
 *
 * It owns no sorting itself — the caller hands the table an already sorted set of
 * rows and keeps this control's value in the same state, which is how the model
 * square has always worked.
 */
export function DataTableSortMenu<TValue extends string>(
  props: DataTableSortMenuProps<TValue>
) {
  const { t } = useTranslation()
  const selected = props.options.find((option) => option.value === props.value)
  const isDescending = props.direction === 'desc'
  const directionLabel = isDescending
    ? t('Sort descending')
    : t('Sort ascending')

  return (
    <div className={cn('flex shrink-0 items-center gap-2', props.className)}>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger
          render={
            <Button
              type='button'
              variant='outline'
              size='sm'
              className='h-8 px-3 text-xs'
            />
          }
        >
          <span>{selected?.label ?? props.options[0]?.label}</span>
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end' className='w-44'>
          <DropdownMenuGroup>
            {props.options.map((option) => (
              <DropdownMenuItem
                key={option.value}
                onClick={() => props.onValueChange(option.value)}
                className='gap-2'
              >
                <Check
                  className={cn(
                    'size-4 shrink-0',
                    props.value === option.value ? 'opacity-100' : 'opacity-0'
                  )}
                />
                {option.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <Button
        type='button'
        variant='outline'
        size='icon'
        className='size-8'
        aria-label={directionLabel}
        title={directionLabel}
        onClick={() =>
          props.onDirectionChange(isDescending ? 'asc' : 'desc')
        }
      >
        {isDescending ? (
          <ArrowDown className='size-3.5' />
        ) : (
          <ArrowUp className='size-3.5' />
        )}
      </Button>
    </div>
  )
}
