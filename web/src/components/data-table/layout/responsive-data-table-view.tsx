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
import { useMediaQuery } from '@/hooks'

import { DataTableView, type DataTableViewProps } from '../core/data-table-view'
import { MobileCardList } from './mobile-card-list'

/**
 * `DataTableView` with the shared narrow-screen fallback.
 *
 * Narrow viewports (<= 640px) always get the card list: a table squeezed into a
 * phone width either clips its columns or scrolls them out of reach, so every
 * table — including the ones rendered inside dialogs and panels that do not go
 * through `DataTablePage` — renders the same {@link MobileCardList} instead.
 * Tablet widths and up keep the table.
 *
 * The card list is content-height and clips its own overflow, so the narrow
 * branch owns the scroll area the same way `DataTablePage` does. Without it the
 * list is clipped by whichever ancestor hides overflow (the page content area
 * does) and every row past the fold becomes unreachable: in the narrow
 * model-pricing table that meant no scrolling and no way to select those rows.
 * Where the caller is not a bounded flex column (a dialog body that scrolls
 * itself) the wrapper stays inert.
 */
export function ResponsiveDataTableView<TData>(
  props: DataTableViewProps<TData>
) {
  const isNarrowViewport = useMediaQuery('(max-width: 640px)')

  if (!isNarrowViewport) {
    return <DataTableView {...props} />
  }

  return (
    <div className='min-h-0 flex-1 overflow-y-auto'>
      <MobileCardList
        table={props.table}
        enableRowSelection={props.table.options.enableRowSelection === true}
        isLoading={props.isLoading}
        emptyTitle={props.emptyTitle}
        emptyDescription={props.emptyDescription}
      />
    </div>
  )
}
