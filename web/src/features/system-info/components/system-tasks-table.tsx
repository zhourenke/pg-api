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

import { ResponsiveDataTableView } from '@/components/data-table'
import type { SystemTask } from '@/features/system-settings/types'

/**
 * System task rows in the shared table: a table whose columns take the width
 * their own content needs on wide screens, and the shared card list below the
 * narrow breakpoint, where a table would only clip or scroll sideways.
 *
 * The active-task table and the task history both render their rows through
 * here, so the two surfaces cannot drift apart in either form.
 *
 * The dense 13px typography is the same one the log tables use: these rows are
 * read as a list of short facts, and the shipped cell typography is what the
 * width measurement copies, so the size has to reach the table from the outside
 * rather than from classes inside the cells.
 */
export function SystemTasksTable(props: { table: Table<SystemTask> }) {
  return (
    <ResponsiveDataTableView
      table={props.table}
      applyHeaderSize
      containerClassName='[&_[data-slot=table]]:text-[13px] [&_[data-slot=table]_td]:text-[13px] [&_[data-slot=table]_td_*]:text-[13px] [&_[data-slot=table]_th]:text-[13px] [&_[data-slot=table]_th_*]:text-[13px]'
    />
  )
}
