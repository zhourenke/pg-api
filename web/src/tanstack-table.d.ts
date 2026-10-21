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
import '@tanstack/react-table'

declare module '@tanstack/react-table' {
  interface TableMeta<_TData> {
    /**
     * Key that identifies the table content layout/mode (e.g. tag mode vs normal mode).
     * When this key changes, column widths adapt to the new content structure.
     */
    measurementKey?: unknown
    /**
     * Re-measures and adapts column widths to the current content.
     */
    fitColumnWidths?: () => void
  }

  interface ColumnMeta<_TData, _TValue> {
    label?: string
    description?: string
    className?: string
    pinned?: 'left' | 'right'
    /**
     * How a resizable table gives this column its width. `fit` (the default)
     * measures the column to the widest content it holds; `window` leaves the
     * declared `size` untouched and is never measured, for a column that renders
     * a window onto content of its own length rather than the content itself
     * (an error summary clamped to two lines, a truncated preview).
     */
    measurement?: 'fit' | 'window'
    // Mobile card list layout hints (used by MobileCardList)
    mobileTitle?: boolean // card title area (left, larger text)
    mobileBadge?: boolean // status badge alongside title (right)
    mobileHidden?: boolean // hide this column on mobile entirely
    mobileOrder?: number // lower values appear first in card field area
  }
}
