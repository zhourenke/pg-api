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
import { flexRender, type Row } from '@tanstack/react-table'
import { memo } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadgeTypeContext } from '@/components/status-badge'

import { CHANNEL_STATUS } from '../constants'
import { isTagAggregateRow, parseGroupsList } from '../lib'
import type { Channel } from '../types'
import { ChannelRowActionsLayoutContext } from './channel-row-actions-context'
import { BalanceCell } from './channels-columns'
import { useChannels } from './channels-provider'

const SENSITIVE_MASK = '••••'

/**
 * Bespoke channel card for the card view. Reuses every column's existing cell
 * renderer via `flexRender`, so the table's information and interactions are
 * preserved: row selection, provider/multi-key/IO.NET type badge, id,
 * name/remark + warning icons, status (with tooltips), groups, inline
 * priority/weight spinners, balance refresh, response/test times, tag
 * expand-collapse, and the per-row (or per-tag) actions menu. The balance cell
 * is the one exception: it is rendered here directly, because the card splits
 * the used and remaining figures into two cells of its own.
 */
function ChannelCardComponent({
  row,
  isSelected,
}: {
  row: Row<Channel>
  isSelected: boolean
}) {
  const { t } = useTranslation()
  const { sensitiveVisible } = useChannels()
  const isTagRow = isTagAggregateRow(row.original)
  const cells = row.getAllCells()

  const renderCell = (id: string) => {
    const cell = cells.find((c) => c.column.id === id)
    if (!cell || !cell.column.columnDef.cell) {
      return null
    }
    return flexRender(cell.column.columnDef.cell, cell.getContext())
  }

  const groups = parseGroupsList(row.original.group ?? '')

  const selectCell = renderCell('select')
  const typeCell = renderCell('type')
  const nameCell = renderCell('name')
  const statusCell = renderCell('status')
  const actionsCell = renderCell('actions')
  const priorityCell = renderCell('priority')
  const weightCell = renderCell('weight')
  const responseCell = renderCell('response_time')
  const testCell = renderCell('test_time')
  // A tag row aggregates several channels and has no single remaining figure, so
  // the card shows a dash there.
  const usedBalanceCell = <BalanceCell channel={row.original} part='used' />
  const remainingBalanceCell = isTagRow ? null : (
    <BalanceCell channel={row.original} part='remaining' />
  )

  const labelClass = 'text-muted-foreground text-[11px] font-medium select-none'

  // In card view the enable/disable state is already conveyed by the inline
  // power toggle, so the plain "Enabled"/"Disabled" badge is redundant. Keep
  // only the informative states (e.g. auto-disabled, unknown) and tag rows.
  const showStatusBadge =
    isTagRow ||
    (row.original.status !== CHANNEL_STATUS.ENABLED &&
      row.original.status !== CHANNEL_STATUS.MANUAL_DISABLED)

  return (
    <ChannelRowActionsLayoutContext.Provider value='card'>
      <div
        data-state={isSelected ? 'selected' : undefined}
        className='flex min-w-0 flex-col gap-3'
      >
        {/* Row 1: selection + type, with status badge + actions menu */}
        <div className='flex items-center justify-between gap-2'>
          <div className='flex min-w-0 flex-1 items-center gap-2'>
            {!isTagRow && selectCell && (
              <span className='shrink-0'>{selectCell}</span>
            )}
            <div className='min-w-0 overflow-hidden'>{typeCell}</div>
          </div>
          <div className='flex shrink-0 items-center gap-1.5'>
            {showStatusBadge && statusCell}
            {actionsCell}
          </div>
        </div>

        {/* The identity gets a row of its own and the six facts on it share the
          two rows below in three equal columns, so nothing is pushed to the
          right edge and no figure has to give way for the spinners the way the
          identity did when it shared their row. The cost is one extra row per
          card. Each figure is centred in its own column, label and value alike,
          which leaves the column's slack on both sides of it instead of stacking
          it all against the left edge; the identity and the groups footer stay
          left-aligned, being full-width lines rather than figures in a column.
          The two spinner columns take their width from the grid, not from their
          content: the +/- buttons inside the inline spinner appear through a
          container query, and a box sized by the very buttons that query gates
          would collapse — hidden buttons measure a few pixels, the query stays
          false, and the buttons stay hidden. The table gets that definite width
          from its colgroup, the card gets it from the equal tracks. */}
        <StatusBadgeTypeContext.Provider value='text'>
          <div className='grid grid-cols-3 items-start gap-3'>
            <div className='col-span-3 min-w-0 overflow-hidden text-sm'>
              {!isTagRow && (
                <div className={labelClass}>
                  #{sensitiveVisible ? row.original.id : SENSITIVE_MASK}
                </div>
              )}
              {nameCell}
            </div>
            <div className='flex min-w-0 flex-col gap-1 text-center'>
              <span className={labelClass}>{t('Used')}</span>
              <div className='min-w-0 text-sm tabular-nums [&>*]:!ml-0'>
                {usedBalanceCell}
              </div>
            </div>
            <div className='col-start-2 flex min-w-0 flex-col gap-1 text-center'>
              <span className={labelClass}>{t('Priority')}</span>
              {priorityCell}
            </div>
            <div className='col-start-3 flex min-w-0 flex-col gap-1 text-center'>
              <span className={labelClass}>{t('Weight')}</span>
              {weightCell}
            </div>
            <dl className='col-span-3 grid grid-cols-subgrid gap-y-1'>
              <div className='row-span-2 grid min-w-0 grid-rows-subgrid text-center'>
                <dt className={labelClass}>{t('Remaining')}</dt>
                <dd className='min-w-0 text-sm tabular-nums [&>*]:!ml-0'>
                  {remainingBalanceCell ?? (
                    <span className='text-muted-foreground'>-</span>
                  )}
                </dd>
              </div>
              <div className='row-span-2 grid min-w-0 grid-rows-subgrid text-center'>
                <dt className={labelClass}>{t('Response')}</dt>
                <dd className='min-w-0 text-sm tabular-nums [&_[data-slot=status-badge]]:!ml-0'>
                  {responseCell ?? (
                    <span className='text-muted-foreground'>-</span>
                  )}
                </dd>
              </div>
              <div className='row-span-2 grid min-w-0 grid-rows-subgrid text-center'>
                <dt className={labelClass}>{t('Last Tested')}</dt>
                {/* The value is a plain span here: its cell renders a badge
                  inside a tooltip trigger, and the trigger's own `data-slot`
                  replaces the badge's, so the negative margin the badge carries
                  for the table's padding is cancelled on the child instead. */}
                <dd className='min-w-0 text-sm [&>span]:ml-0'>
                  {testCell ?? <span className='text-muted-foreground'>-</span>}
                </dd>
              </div>
            </dl>
          </div>
        </StatusBadgeTypeContext.Provider>

        {/* Groups retain their compact, full-width footer. */}
        <div className='min-w-0'>
          {groups.length > 0 ? (
            <div className='-ml-1.5 flex min-w-0 flex-wrap gap-1'>
              {groups.map((g) => (
                <GroupBadge
                  key={g}
                  group={g}
                  label={sensitiveVisible ? undefined : SENSITIVE_MASK}
                  size='sm'
                />
              ))}
            </div>
          ) : (
            <span className='text-muted-foreground text-sm'>-</span>
          )}
        </div>
      </div>
    </ChannelRowActionsLayoutContext.Provider>
  )
}

/**
 * Memoized so each card only re-renders when its own react-table row reference
 * changes, instead of every card re-rendering whenever the parent table state
 * (filters, pagination, sensitive toggle, etc.) updates.
 */
export const ChannelCard = memo(ChannelCardComponent)
