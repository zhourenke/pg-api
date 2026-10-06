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
import { StatusBadge } from '@/components/status-badge'
import dayjs from '@/lib/dayjs'

import type { AuditLog } from '../api'
import { buildAuditDetails } from '../lib/audit-details'
import { AuditLogDetailsDialog } from './audit-log-details-dialog'

export function useAuditLogColumns(
  accessOnly?: boolean
): ColumnDef<AuditLog>[] {
  const { t } = useTranslation()
  return useMemo(() => {
    const columns: ColumnDef<AuditLog>[] = [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => (
          <TruncatedCell className='font-mono tabular-nums'>
            {dayjs.unix(row.original.created_at).format('YYYY-MM-DD HH:mm:ss')}
          </TruncatedCell>
        ),
        meta: { label: t('Time'), mobileTitle: true },
      },
    ]
    if (!accessOnly) {
      columns.push(
        {
          accessorKey: 'username',
          header: t('Username'),
          meta: { label: t('Username') },
        },
        {
          id: 'event',
          header: t('Event'),
          accessorFn: (entry) => {
            const detail = buildAuditDetails(entry, t)
            return [detail.summary, detail.operation?.description]
              .filter(Boolean)
              .join(' · ')
          },
          cell: ({ row, getValue }) => {
            const operation = buildAuditDetails(row.original, t).operation
            if (!operation) {
              return <TruncatedCell>{getValue<string>()}</TruncatedCell>
            }
            return (
              <div className='min-w-0 space-y-1'>
                <div className='flex min-w-0 items-baseline gap-1'>
                  <TruncatedCell
                    className='min-w-0 font-medium'
                    tooltipContent={operation.summary}
                  >
                    {operation.headline}
                  </TruncatedCell>
                  {operation.identifier && (
                    <span className='shrink-0 whitespace-nowrap'>
                      {operation.identifier}
                    </span>
                  )}
                </div>
                {operation.description && (
                  <TruncatedCell
                    className='text-muted-foreground'
                    contentClassName='line-clamp-2 whitespace-normal break-words'
                    tooltipContent={operation.description}
                  >
                    {operation.description}
                  </TruncatedCell>
                )}
              </div>
            )
          },
          meta: { label: t('Event') },
        }
      )
    }
    columns.push(
      {
        accessorKey: 'ip',
        header: 'IP',
        cell: ({ row }) => (
          <TruncatedCell className='font-mono'>
            {row.original.ip || '—'}
          </TruncatedCell>
        ),
        meta: { label: 'IP' },
      },
      {
        accessorKey: 'method',
        header: t('Method'),
        cell: ({ row }) => (
          <TruncatedCell className='text-muted-foreground font-mono'>
            {row.original.method || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Method') },
      },
      {
        accessorKey: 'route',
        header: t('Route'),
        cell: ({ row }) => (
          <TruncatedCell className='font-mono'>
            {row.original.route || '—'}
          </TruncatedCell>
        ),
        meta: { label: t('Route') },
      },
      {
        accessorKey: 'status',
        header: 'HTTP',
        cell: ({ row }) => (
          <TruncatedCell className='font-mono tabular-nums'>
            {row.original.status || '—'}
          </TruncatedCell>
        ),
        meta: { label: 'HTTP' },
      },
      {
        accessorKey: 'success',
        header: t('Result'),
        cell: ({ row }) => (
          <StatusBadge
            label={row.original.success ? t('Success') : t('Failed')}
            variant={row.original.success ? 'success' : 'danger'}
            copyable={false}
          />
        ),
        meta: { label: t('Result'), mobileBadge: true },
      },
      {
        id: 'details',
        header: t('Details'),
        enableHiding: false,
        cell: ({ row }) => <AuditLogDetailsDialog entry={row.original} />,
        meta: { label: t('Details') },
      }
    )
    return columns
  }, [accessOnly, t])
}
