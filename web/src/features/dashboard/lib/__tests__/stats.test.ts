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
import { describe, expect, it } from 'vitest'

import {
  calculateDashboardStats,
  formatSharePercent,
  safeDivide,
  sharePercent,
  sortRowsBy,
} from '../stats'

describe('dashboard stats utilities', () => {
  it('handles safeDivide bounds and edge cases', () => {
    expect(safeDivide(10, 2)).toBe(5)
    expect(safeDivide(10, 0)).toBe(0)
    expect(safeDivide(0, 0)).toBe(0)
    expect(safeDivide(Number.NaN, 2)).toBe(0)
    expect(safeDivide(1, 3, 2)).toBe(0.33)
  })

  it('writes a tiny but non-zero share as less than 0.1 percent', () => {
    expect(formatSharePercent(0)).toBe('0%')
    expect(formatSharePercent(0.04)).toBe('<0.1%')
    expect(formatSharePercent(0.1)).toBe('0.1%')
    expect(formatSharePercent(88.94)).toBe('88.9%')
    expect(formatSharePercent(100)).toBe('100%')
    expect(formatSharePercent(Number.NaN)).toBe('0%')
  })

  it('keeps a tiny share distinguishable from nothing before formatting', () => {
    expect(sharePercent(1, 10000)).toBeCloseTo(0.01, 6)
    expect(sharePercent(1, 0)).toBe(0)
    expect(sharePercent(Number.NaN, 10)).toBe(0)
    // The pair that made a real table row read 0% while it had consumed quota.
    expect(formatSharePercent(sharePercent(1, 1200000))).toBe('<0.1%')
  })

  it('sorts rows numerically or as text, in either direction, without mutating the input', () => {
    const rows = [
      { name: 'gemini-3.8-flash', count: 2359, quota: 11 },
      { name: 'deepseek-v4.1-flash', count: 13, quota: 0.0121 },
      { name: 'claude-opus-5-5', count: 400, quota: 4 },
    ]

    expect(sortRowsBy(rows, 'count', 'desc').map((row) => row.name)).toEqual([
      'gemini-3.8-flash',
      'claude-opus-5-5',
      'deepseek-v4.1-flash',
    ])
    expect(sortRowsBy(rows, 'name', 'asc').map((row) => row.name)).toEqual([
      'claude-opus-5-5',
      'deepseek-v4.1-flash',
      'gemini-3.8-flash',
    ])
    expect(sortRowsBy(rows, 'quota', 'asc')[0].quota).toBe(0.0121)
    expect(rows[0].name).toBe('gemini-3.8-flash')
  })

  it('calculates basic dashboard stats', () => {
    const data = [
      { created_at: 1000, count: 5, quota: 1000, token_used: 250 },
      { created_at: 2000, count: 10, quota: 2000, token_used: 500 },
    ]

    const stats = calculateDashboardStats(data)
    expect(stats.totalCount).toBe(15)
    expect(stats.totalQuota).toBe(3000)
    expect(stats.totalTokens).toBe(750)
  })
})
