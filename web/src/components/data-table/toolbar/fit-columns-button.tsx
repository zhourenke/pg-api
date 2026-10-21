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
  table: Table<TData>
  className?: string
  size?: React.ComponentProps<typeof Button>['size']
  variant?: React.ComponentProps<typeof Button>['variant']
  showIcon?: boolean
  hideTextOnMobile?: boolean
  onClick?: () => void
}

export function DataTableFitColumnsButton<TData>(
  props: DataTableFitColumnsButtonProps<TData>
) {
  const { t } = useTranslation()

  const handleClick = () => {
    props.onClick?.()
    props.table.options.meta?.fitColumnWidths?.()
  }

  const showIcon = props.showIcon ?? true
  const hideTextOnMobile = props.hideTextOnMobile ?? true

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
      {showIcon && <StretchHorizontal className='size-3.5' aria-hidden='true' />}
      <span className={cn(hideTextOnMobile && 'hidden sm:inline')}>
        {t('Fit column widths')}
      </span>
    </Button>
  )
}
