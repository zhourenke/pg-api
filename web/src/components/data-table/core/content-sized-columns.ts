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
/**
 * Row actions never get a resize handle and are sized by their own content
 * rather than by a declared width, so the controls stay whole at any zoom.
 */
export function isContentSizedColumn(columnId: string): boolean {
  return columnId === 'actions'
}

/**
 * The invisible spacer that closes a resizable table. Its column has no declared
 * width, so the browser gives it every pixel the sized columns do not use: the
 * table still fills its container while each real column keeps exactly the width
 * it was given, and dragging one column can no longer move its neighbours.
 */
export const FILLER_COLUMN_ID = '__filler'

export function isFillerColumn(columnId: string): boolean {
  return columnId === FILLER_COLUMN_ID
}
