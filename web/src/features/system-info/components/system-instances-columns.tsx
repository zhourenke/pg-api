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
/* eslint-disable react-refresh/only-export-components */
import type { ColumnDef } from '@tanstack/react-table'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { TruncatedCell } from '@/components/data-table'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { formatTimestampRelative, formatTimestampToDate } from '@/lib/format'
import { cn } from '@/lib/utils'

import type { SystemInstance, SystemInstanceStatus } from '../types'

const STATUS_CLASS_NAME: Record<SystemInstanceStatus, string> = {
  online:
    'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  stale: 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
}

const STATUS_DOT_CLASS_NAME: Record<SystemInstanceStatus, string> = {
  online: 'bg-emerald-500',
  stale: 'bg-amber-500',
}

/** The name an instance is shown and confirmed by, in the table and dialogs. */
export function getNodeName(instance: SystemInstance) {
  return instance.info?.node?.name || instance.node_name
}

function roleLabel(instance: SystemInstance) {
  if (instance.info?.role?.is_master) return 'master'
  return 'worker'
}

function roleDescriptionKey(instance: SystemInstance) {
  if (instance.info?.role?.is_master) {
    return 'Master instances run scheduled background tasks.'
  }
  return 'Worker instances do not run master-only background tasks.'
}

function runtimeLabel(instance: SystemInstance) {
  const runtime = instance.info?.runtime
  if (!runtime?.goos && !runtime?.goarch) return '-'

  const parts: string[] = []
  if (runtime.goos || runtime.goarch) {
    parts.push([runtime.goos, runtime.goarch].filter(Boolean).join('/'))
  }
  return parts.join(' · ')
}

function formatPercent(value?: number) {
  if (typeof value !== 'number' || Number.isNaN(value)) return '-'
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: 1,
  }).format(value)}%`
}

function formatBytes(bytes?: number): string {
  if (typeof bytes !== 'number' || Number.isNaN(bytes)) return '-'
  if (bytes === 0) return '0 B'
  if (bytes < 0) return `-${formatBytes(-bytes)}`

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  )
  const value = bytes / 1024 ** index
  return `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: index === 0 ? 0 : 1,
  }).format(value)} ${units[index]}`
}

function ringColorClass(percent: number | null) {
  if (percent === null) return 'text-muted-foreground/40'
  if (percent >= 90) return 'text-red-500'
  if (percent >= 70) return 'text-amber-500'
  return 'text-emerald-500'
}

type RingProgressProps = {
  percent: number | null
  size?: number
}

function RingProgress(props: RingProgressProps) {
  const size = props.size ?? 22
  const stroke = 2.5
  const radius = (size - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const offset =
    props.percent === null
      ? circumference
      : circumference - (props.percent / 100) * circumference

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className='shrink-0 -rotate-90'
      aria-hidden='true'
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        strokeWidth={stroke}
        stroke='currentColor'
        className='text-muted'
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill='none'
        strokeWidth={stroke}
        strokeLinecap='round'
        stroke='currentColor'
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className={cn(
          'transition-[stroke-dashoffset] duration-500',
          ringColorClass(props.percent)
        )}
      />
    </svg>
  )
}

type ResourceCellProps = {
  value?: number
  tooltip?: ReactNode
}

function ResourceCell(props: ResourceCellProps) {
  const percent =
    typeof props.value === 'number' && !Number.isNaN(props.value)
      ? Math.max(0, Math.min(100, props.value))
      : null
  const content = (
    <div className='flex items-center gap-2'>
      <RingProgress percent={percent} />
      <span className='tabular-nums'>{formatPercent(props.value)}</span>
    </div>
  )

  if (!props.tooltip) return content

  return (
    <TooltipProvider delay={100}>
      <Tooltip>
        <TooltipTrigger className='block w-full rounded-sm text-left focus-visible:ring-2 focus-visible:outline-none'>
          {content}
        </TooltipTrigger>
        <TooltipContent className='max-w-80'>{props.tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export type SystemInstancesColumnsOptions = {
  deletingNodeName: string | null
  isDeletingInstance: boolean
  onDeleteStaleInstance: (instance: SystemInstance) => void
}

export function useSystemInstancesColumns(
  options: SystemInstancesColumnsOptions
): ColumnDef<SystemInstance>[] {
  const { t, i18n } = useTranslation()
  const { deletingNodeName, isDeletingInstance, onDeleteStaleInstance } =
    options
  const locale = toIntlLocale(i18n.language)

  return useMemo<ColumnDef<SystemInstance>[]>(
    () => [
      {
        id: 'node_name',
        accessorKey: 'node_name',
        header: t('Instances'),
        cell: ({ row }) => {
          const instance = row.original
          const shouldConfigure =
            instance.info?.node?.should_configure_manually === true

          return (
            <div className='flex min-w-0 items-center gap-2'>
              <span
                className={cn(
                  'size-2 shrink-0 rounded-full',
                  STATUS_DOT_CLASS_NAME[instance.status]
                )}
                aria-hidden='true'
              />
              <div className='min-w-0'>
                <div className='flex min-w-0 items-center gap-1.5'>
                  <span className='truncate'>{getNodeName(instance)}</span>
                  {shouldConfigure && (
                    <Popover>
                      <PopoverTrigger
                        className='inline-flex shrink-0 rounded-full focus-visible:ring-2 focus-visible:outline-none'
                        aria-label={t('Configure NODE_NAME')}
                      >
                        <Badge
                          variant='outline'
                          className='border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/15 dark:text-amber-300'
                        >
                          <AlertTriangle
                            className='size-3'
                            aria-hidden='true'
                          />
                        </Badge>
                      </PopoverTrigger>
                      <PopoverContent align='start' className='w-80'>
                        <PopoverHeader>
                          <PopoverTitle>
                            {t('Configure NODE_NAME')}
                          </PopoverTitle>
                          <PopoverDescription>
                            {t(
                              'This instance is using an automatic hostname. Set NODE_NAME to a stable unique value for multi-instance management.'
                            )}
                          </PopoverDescription>
                        </PopoverHeader>
                        <div className='space-y-2 text-xs'>
                          <div>
                            <div className='mb-1 font-medium'>
                              {t('Example')}
                            </div>
                            <code className='bg-muted block rounded-md px-2 py-1.5 font-mono text-[11px] break-all'>
                              NODE_NAME=new-api-master-1
                            </code>
                          </div>
                          <p className='text-muted-foreground'>
                            {t(
                              'Use a different stable value for each instance, then restart the service.'
                            )}
                          </p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
                <TruncatedCell className='text-muted-foreground'>
                  {instance.info?.host?.hostname || '-'}
                </TruncatedCell>
              </div>
            </div>
          )
        },
        meta: { label: t('Instances'), mobileTitle: true },
      },
      {
        id: 'status',
        accessorKey: 'status',
        header: t('Status'),
        cell: ({ row }) => (
          <Badge
            variant='secondary'
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
        id: 'role',
        header: t('Role'),
        cell: ({ row }) => (
          <TooltipProvider delay={100}>
            <Tooltip>
              <TooltipTrigger
                className='inline-flex shrink-0 rounded-full focus-visible:ring-2 focus-visible:outline-none'
                aria-label={t('Node role')}
              >
                <Badge variant='outline'>{roleLabel(row.original)}</Badge>
              </TooltipTrigger>
              <TooltipContent>
                {t(roleDescriptionKey(row.original))}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        ),
        meta: { label: t('Role') },
      },
      {
        id: 'cpu',
        header: t('CPU'),
        cell: ({ row }) => (
          <ResourceCell
            value={row.original.info?.resources?.cpu?.usage_percent}
          />
        ),
        meta: { label: t('CPU') },
      },
      {
        id: 'memory',
        header: t('Memory'),
        cell: ({ row }) => (
          <ResourceCell
            value={row.original.info?.resources?.memory?.usage_percent}
          />
        ),
        meta: { label: t('Memory') },
      },
      {
        id: 'storage',
        header: t('Storage'),
        cell: ({ row }) => {
          const storage = row.original.info?.resources?.storage

          return (
            <ResourceCell
              value={storage?.used_percent}
              tooltip={
                storage ? (
                  <div className='space-y-1 text-xs'>
                    <div className='grid grid-cols-[auto_1fr] gap-x-3 gap-y-1'>
                      <span className='text-muted-foreground'>{t('Used')}</span>
                      <span className='font-mono'>
                        {formatBytes(storage.used_bytes)}
                      </span>
                      <span className='text-muted-foreground'>{t('Free')}</span>
                      <span className='font-mono'>
                        {formatBytes(storage.free_bytes)}
                      </span>
                      <span className='text-muted-foreground'>
                        {t('Total')}
                      </span>
                      <span className='font-mono'>
                        {formatBytes(storage.total_bytes)}
                      </span>
                    </div>
                  </div>
                ) : undefined
              }
            />
          )
        },
        meta: { label: t('Storage') },
      },
      {
        id: 'version',
        header: t('Version'),
        cell: ({ row }) => (
          <TruncatedCell>
            {row.original.info?.runtime?.version || '-'}
          </TruncatedCell>
        ),
        meta: { label: t('Version') },
      },
      {
        id: 'runtime',
        header: t('Runtime'),
        cell: ({ row }) => (
          <TruncatedCell>{runtimeLabel(row.original)}</TruncatedCell>
        ),
        meta: { label: t('Runtime') },
      },
      {
        id: 'started',
        accessorKey: 'started_at',
        header: t('Started'),
        cell: ({ row }) => (
          <TruncatedCell className='text-muted-foreground'>
            {formatTimestampToDate(row.original.started_at)}
          </TruncatedCell>
        ),
        meta: { label: t('Started') },
      },
      {
        id: 'last_seen',
        accessorKey: 'last_seen_at',
        header: t('Last Seen'),
        cell: ({ row }) => (
          <TruncatedCell
            className='text-muted-foreground'
            tooltipContent={formatTimestampToDate(row.original.last_seen_at)}
          >
            {formatTimestampRelative(
              row.original.last_seen_at,
              'seconds',
              locale
            )}
          </TruncatedCell>
        ),
        meta: { label: t('Last Seen') },
      },
      {
        id: 'actions',
        header: t('Actions'),
        enableSorting: false,
        enableHiding: false,
        cell: ({ row }) => {
          const instance = row.original
          if (instance.status !== 'stale') {
            return <span className='text-muted-foreground text-xs'>-</span>
          }

          const isDeletingThisInstance =
            isDeletingInstance && deletingNodeName === instance.node_name

          return (
            <div className='flex justify-end'>
              <TooltipProvider delay={100}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        type='button'
                        variant='destructive'
                        size='icon-xs'
                        onClick={() => onDeleteStaleInstance(instance)}
                        disabled={isDeletingInstance || isDeletingThisInstance}
                        aria-label={t('Delete stale instance')}
                      >
                        {isDeletingThisInstance ? (
                          <Loader2
                            className='size-3 animate-spin'
                            aria-hidden='true'
                          />
                        ) : (
                          <Trash2 className='size-3' aria-hidden='true' />
                        )}
                      </Button>
                    }
                  />
                  <TooltipContent>{t('Delete stale instance')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )
        },
        meta: { label: t('Actions') },
      },
    ],
    [t, locale, deletingNodeName, isDeletingInstance, onDeleteStaleInstance]
  )
}
