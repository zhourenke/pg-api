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
import type { ColumnDef } from '@tanstack/react-table'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import type {
  SystemTask,
  SystemTaskStatus,
} from '@/features/system-settings/types'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import { SYSTEM_TASK_TYPE_LABEL } from '../constants'

const STATUS_VARIANT: Record<SystemTaskStatus, 'secondary' | 'destructive'> = {
  pending: 'secondary',
  running: 'secondary',
  succeeded: 'secondary',
  failed: 'destructive',
}

const STATUS_CLASS_NAME: Record<SystemTaskStatus, string> = {
  pending:
    'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  running:
    'bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300 [&_span]:bg-sky-500',
  succeeded:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: '',
}

const STATUS_DOT_CLASS_NAME: Record<SystemTaskStatus, string> = {
  pending: 'bg-amber-500',
  running: 'bg-sky-500',
  succeeded: 'bg-emerald-500',
  failed: 'bg-destructive',
}

const PROGRESS_BAR_CLASS_NAME: Record<SystemTaskStatus, string> = {
  pending: '[&_[data-slot=progress-indicator]]:bg-amber-500',
  running: '[&_[data-slot=progress-indicator]]:bg-sky-500',
  succeeded: '[&_[data-slot=progress-indicator]]:bg-emerald-500',
  failed: '[&_[data-slot=progress-indicator]]:bg-destructive',
}

function getProgress(task: SystemTask): number | null {
  const progress = (task.state as { progress?: unknown } | undefined)?.progress
  if (typeof progress !== 'number' || Number.isNaN(progress)) return null
  return Math.min(100, Math.max(0, progress))
}

export function useSystemTasksColumns(): ColumnDef<SystemTask>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.language)

  return useMemo<ColumnDef<SystemTask>[]>(
    () => [
      {
        id: 'type',
        accessorKey: 'type',
        header: t('Type'),
        size: 260,
        cell: ({ row }) => (
          <div className='space-y-0.5'>
            <div>
              {t(
                SYSTEM_TASK_TYPE_LABEL[row.original.type] ?? row.original.type
              )}
            </div>
            <div className='text-muted-foreground'>{row.original.type}</div>
          </div>
        ),
        meta: { label: t('Type'), mobileTitle: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('Status'),
        size: 130,
        cell: ({ row }) => (
          <Badge
            variant={STATUS_VARIANT[row.original.status]}
            className={cn('gap-1.5', STATUS_CLASS_NAME[row.original.status])}
          >
            <span
              className={cn(
                'size-1.5 rounded-full',
                STATUS_DOT_CLASS_NAME[row.original.status]
              )}
              aria-hidden='true'
            />
            {t(row.original.status)}
          </Badge>
        ),
        meta: { label: t('Status'), mobileBadge: true },
      },
      {
        id: 'progress',
        header: t('Progress'),
        size: 180,
        cell: ({ row }) => {
          const progress = getProgress(row.original)

          return (
            <div className='flex items-center gap-2'>
              <Progress
                value={progress ?? 0}
                className={cn(
                  'w-24',
                  PROGRESS_BAR_CLASS_NAME[row.original.status]
                )}
              />
              <span className='text-muted-foreground w-10 text-right tabular-nums'>
                {progress === null ? '-' : `${progress}%`}
              </span>
            </div>
          )
        },
        meta: { label: t('Progress') },
      },
      {
        id: 'executor',
        accessorKey: 'locked_by',
        header: t('Executor'),
        size: 260,
        cell: ({ row }) => {
          // An empty executor is shown as a dash, and a dash is not worth a
          // tooltip, so the tooltip content is what decides whether one exists.
          const executor = row.original.locked_by || ''

          return (
            <TruncatedCell
              className='text-muted-foreground'
              tooltipContent={executor}
            >
              {executor || '-'}
            </TruncatedCell>
          )
        },
        meta: { label: t('Executor') },
      },
      {
        id: 'updated',
        accessorKey: 'updated_at',
        header: t('Updated'),
        size: 190,
        cell: ({ row }) => (
          <TruncatedCell
            className='text-muted-foreground'
            tooltipContent={formatTimestampToDate(row.original.updated_at)}
          >
            {formatTimestampRelative(
              row.original.updated_at,
              'seconds',
              locale
            )}
          </TruncatedCell>
        ),
        meta: { label: t('Updated') },
      },
      {
        id: 'detail',
        accessorKey: 'error',
        header: t('Detail'),
        size: 220,
        cell: ({ row }) => {
          const detail = row.original.error || ''

          return (
            <TruncatedCell className='text-destructive' tooltipContent={detail}>
              {detail || '-'}
            </TruncatedCell>
          )
        },
        meta: { label: t('Detail') },
      },
    ],
    [t, locale]
  )
}
