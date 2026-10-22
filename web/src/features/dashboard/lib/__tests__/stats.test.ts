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
  calculateExtendedDashboardStats,
  safeDivide,
} from '../stats'

describe('dashboard stats utilities', () => {
  it('handles safeDivide bounds and edge cases', () => {
    expect(safeDivide(10, 2)).toBe(5)
    expect(safeDivide(10, 0)).toBe(0)
    expect(safeDivide(0, 0)).toBe(0)
    expect(safeDivide(Number.NaN, 2)).toBe(0)
    expect(safeDivide(1, 3, 2)).toBe(0.33)
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

  it('calculates extended dashboard stats with unit economics and sparklines', () => {
    const start = 1000
    const end = 2200 // 1200s span = 20 minutes
    const data = [
      {
        created_at: 1000,
        count: 10,
        quota: 10000,
        token_used: 2000,
        model_name: 'gpt-4o',
        username: 'alice',
      },
      {
        created_at: 1600,
        count: 20,
        quota: 20000,
        token_used: 4000,
        model_name: 'claude-3-5',
        username: 'bob',
      },
      {
        created_at: 2200,
        count: 10,
        quota: 10000,
        token_used: 2000,
        model_name: 'gpt-4o',
        username: 'alice',
      },
    ]

    const stats = calculateExtendedDashboardStats(data, start, end, 6)

    expect(stats.totalCount).toBe(40)
    expect(stats.totalQuota).toBe(40000)
    expect(stats.totalTokens).toBe(8000)

    // Unit economics
    expect(stats.avgCostPerRequest).toBe(1000) // 40000 / 40
    expect(stats.avgTokensPerRequest).toBe(200) // 8000 / 40

    // Unique active dimensions
    expect(stats.uniqueModelsCount).toBe(2) // gpt-4o, claude-3-5
    expect(stats.uniqueUsersCount).toBe(2) // alice, bob

    // RPM & TPM
    expect(stats.avgRpm).toBe(2) // 40 / 20 min = 2
    expect(stats.avgTpm).toBe(400) // 8000 / 20 min = 400

    // Sparklines length
    expect(stats.sparklines.quota).toHaveLength(6)
    expect(stats.sparklines.count).toHaveLength(6)
    expect(stats.sparklines.tokens).toHaveLength(6)

    // Sparklines sum matches total
    const quotaSum = stats.sparklines.quota.reduce((a, b) => a + b, 0)
    expect(quotaSum).toBe(40000)
  })

  it('returns valid empty stats when given empty data', () => {
    const stats = calculateExtendedDashboardStats([], 1000, 2000, 6)
    expect(stats.totalCount).toBe(0)
    expect(stats.totalQuota).toBe(0)
    expect(stats.totalTokens).toBe(0)
    expect(stats.avgRpm).toBe(0)
    expect(stats.avgTpm).toBe(0)
    expect(stats.avgCostPerRequest).toBe(0)
    expect(stats.avgTokensPerRequest).toBe(0)
    expect(stats.uniqueModelsCount).toBe(0)
    expect(stats.uniqueUsersCount).toBe(0)
    expect(stats.sparklines.quota).toHaveLength(6)
    expect(stats.sparklines.quota.every((v) => v === 0)).toBe(true)
  })
})
