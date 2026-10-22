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
import { useMediaQuery } from '@/hooks'
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
   * Render the leading stretch icon. Defaults to `true`.
   */
  showIcon?: boolean
  onClick?: () => void
}

/**
 * Trigger for `table.options.meta.fitColumnWidths`.
 *
 * The visible label is the short `自适应`; the full `自适应列宽` stays in the
 * accessible name and the native tooltip.
 *
 * Renders nothing at the same narrow width where `ResponsiveDataTableView` and
 * `DataTablePage` replace the table with the card list: there are no column
 * widths to fit there, and collapsing to the icon alone only leaves a control
 * that acts on a table the user cannot see.
 */
export function DataTableFitColumnsButton<TData>(
  props: DataTableFitColumnsButtonProps<TData>
) {
  const { t } = useTranslation()
  const isNarrowViewport = useMediaQuery('(max-width: 640px)')

  if (isNarrowViewport) {
    return null
  }

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
      <span className='whitespace-nowrap'>{t('Fit columns')}</span>
    </Button>
  )
}
