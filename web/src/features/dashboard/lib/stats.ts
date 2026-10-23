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
import type { DataTableSortDirection } from '@/components/data-table'
import type { QuotaDataItem } from '@/features/dashboard/types'

/**
 * Safe division: handles NaN and Infinity cases
 */
export function safeDivide(
  value: number,
  divisor: number,
  precision: number = 3
): number {
  const result = value / divisor
  if (Number.isNaN(result) || !Number.isFinite(result)) return 0
  const factor = Math.pow(10, precision)
  return Math.round(result * factor) / factor
}

/**
 * Orders rows by one of their own fields, the way the model square orders its
 * table: the caller sorts the data and hands the table the result, instead of
 * letting the table sort itself. Numbers compare numerically, everything else
 * compares as text, and rows with equal values keep their incoming order.
 */
export function sortRowsBy<T>(
  rows: readonly T[],
  key: keyof T,
  direction: DataTableSortDirection
): T[] {
  const factor = direction === 'asc' ? 1 : -1

  return [...rows].sort((left, right) => {
    const leftValue = left[key]
    const rightValue = right[key]

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return (leftValue - rightValue) * factor
    }

    return (
      String(leftValue).localeCompare(String(rightValue), undefined, {
        sensitivity: 'base',
      }) * factor
    )
  })
}

/**
 * A share of a total, expressed in percent and deliberately left unrounded:
 * rounding here would turn a model or user that did consume quota into `0%`.
 * {@link formatSharePercent} owns the displayed precision.
 */
export function sharePercent(value: number, total: number): number {
  if (!total) return 0
  const percent = (value / total) * 100
  return Number.isFinite(percent) ? percent : 0
}

/**
 * Formats a share that is already expressed in percent, keeping one decimal.
 * A share that is small but not zero is written as `<0.1%`: rounding it to
 * `0%` would claim the model or user consumed nothing.
 */
export function formatSharePercent(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%'
  if (share < 0.1) return '<0.1%'
  return `${Number(share.toFixed(1))}%`
}

/**
 * Calculate aggregated statistics from quota data
 */
export function calculateDashboardStats(data: QuotaDataItem[]) {
  return data.reduce(
    (acc, item) => ({
      totalQuota: acc.totalQuota + (Number(item.quota) || 0),
      totalCount: acc.totalCount + (Number(item.count) || 0),
      totalTokens: acc.totalTokens + (Number(item.token_used) || 0),
    }),
    { totalQuota: 0, totalCount: 0, totalTokens: 0 }
  )
}

export type DashboardStats = ReturnType<typeof calculateDashboardStats>
