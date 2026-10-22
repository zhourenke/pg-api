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
import type { Table } from '@tanstack/react-table'
import { StretchHorizontal } from 'lucide-react'
import * as React from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type DataTableFitColumnsButtonProps<TData> = {
  /**
   * Table whose `meta.fitColumnWidths` performs the fit. Omit it when the caller
   * already holds the handler and passes it through `onClick`.
   */
  table?: Table<TData>
  className?: string
  size?: React.ComponentProps<typeof Button>['size']
  variant?: React.ComponentProps<typeof Button>['variant']
  /**
   * Render the leading stretch icon. Defaults to `true`; the label collapses to
   * the icon alone below the `md` breakpoint only while the icon is present.
   */
  showIcon?: boolean
  onClick?: () => void
}

/**
 * Trigger for `table.options.meta.fitColumnWidths`.
 *
 * The visible label is the short `自适应` (full text lives in the accessible
 * name and the native tooltip), and it is dropped below `md` so a crowded
 * toolbar keeps the action cluster on one row instead of wrapping.
 */
export function DataTableFitColumnsButton<TData>(
  props: DataTableFitColumnsButtonProps<TData>
) {
  const { t } = useTranslation()

  const handleClick = () => {
    props.onClick?.()
    props.table?.options.meta?.fitColumnWidths?.()
  }

  const showIcon = props.showIcon ?? true

  return (
    <Button
      type='button'
      variant={props.variant ?? 'outline'}
      size={props.size}
      onClick={handleClick}
      className={cn('shrink-0 gap-1.5', props.className)}
      title={t('Fit column widths')}
      aria-label={t('Fit column widths')}
    >
      {showIcon && (
        <StretchHorizontal className='size-3.5' aria-hidden='true' />
      )}
      <span className={cn('whitespace-nowrap', showIcon && 'hidden md:inline')}>
        {t('Fit columns')}
      </span>
    </Button>
  )
}
