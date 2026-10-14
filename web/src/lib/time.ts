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
 * Time utility functions for consistent time handling across the application
 */
import dayjs from '@/lib/dayjs'

/**
 * Time granularity type
 */
export type TimeGranularity = 'hour' | 'day' | 'week'

/**
 * Format Date object to YYYY-MM-DD HH:mm:ss
 */
export function formatDateTimeObject(date: Date): string {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

/**
 * Format timestamp for chart display based on time granularity
 * @param timestamp Unix timestamp in seconds
 * @param granularity Time granularity: 'hour', 'day', or 'week'
 * @returns Formatted string suitable for chart axis
 */
export function formatChartTime(
  timestamp: number,
  granularity: TimeGranularity = 'day'
): string {
  const d = dayjs(timestamp * 1000)
  let result = d.format('MM-DD')

  if (granularity === 'hour') {
    result += ` ${d.format('HH')}:00`
  } else if (granularity === 'week') {
    const weekEnd = d.add(6, 'day')
    result += ` - ${weekEnd.format('MM-DD')}`
  }

  return result
}

/**
 * Add time duration to a date
 * @param months Number of months to add
 * @param days Number of days to add
 * @param hours Number of hours to add
 * @param baseDate Base date to add time to (defaults to now)
 * @returns New date with added time, or undefined if all parameters are 0
 */
export function addTimeToDate(
  months: number,
  days: number,
  hours: number,
  baseDate: Date = new Date()
): Date | undefined {
  if (months === 0 && days === 0 && hours === 0) {
    return undefined
  }

  const result = new Date(baseDate)
  result.setMonth(result.getMonth() + months)
  result.setDate(result.getDate() + days)
  result.setHours(result.getHours() + hours)

  return result
}
