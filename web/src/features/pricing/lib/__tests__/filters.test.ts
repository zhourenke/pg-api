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

import { QUOTA_TYPES } from '../../constants'
import type { PricingModel } from '../../types'
import { filterByQuotaType } from '../filters'

function model(overrides: Partial<PricingModel>): PricingModel {
  return {
    id: 1,
    model_name: 'model',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 1,
    enable_groups: ['default'],
    ...overrides,
  }
}

const models: PricingModel[] = [
  model({ id: 1, model_name: 'ratio-only' }),
  model({ id: 2, model_name: 'legacy-per-call', quota_type: 1 }),
  model({
    id: 3,
    model_name: 'expression-per-call',
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("按次", fixed(0.02))',
  }),
  model({
    id: 4,
    model_name: 'expression-mixed',
    billing_mode: 'tiered_expr',
    billing_expr:
      'len < 1000 ? tier("request", fixed(0.01)) : tier("tokens", p * 2 + c * 8)',
  }),
  model({
    id: 5,
    model_name: 'unclassifiable-expression',
    billing_mode: 'tiered_expr',
    billing_expr: 'max(p * 2, 100)',
  }),
]

function names(quotaType: string): string[] {
  return filterByQuotaType(models, quotaType).map((item) => item.model_name)
}

describe('filterByQuotaType', () => {
  it('files expression prices by their own leaves instead of the legacy field', () => {
    // `quota_type` 只认 legacy 的按次价格表，表达式里的 `fixed()` 在它那里是 0，
    // 所以按次模型会被算进按量；筛选要读表达式自己的档位。
    expect(names(QUOTA_TYPES.REQUEST)).toEqual([
      'legacy-per-call',
      'expression-per-call',
    ])
    expect(names(QUOTA_TYPES.MIXED)).toEqual(['expression-mixed'])
    // 没有档位可读的表达式（特殊表达式）与纯倍率模型都算按量，不会凭空消失。
    expect(names(QUOTA_TYPES.TOKEN)).toEqual([
      'ratio-only',
      'unclassifiable-expression',
    ])
  })

  it('keeps the three buckets exclusive and complete', () => {
    const bucketed = [
      QUOTA_TYPES.TOKEN,
      QUOTA_TYPES.REQUEST,
      QUOTA_TYPES.MIXED,
    ].flatMap(names)
    expect(bucketed).toHaveLength(models.length)
    expect(new Set(bucketed).size).toBe(models.length)
  })

  it('returns the whole catalog for the all bucket', () => {
    expect(names(QUOTA_TYPES.ALL)).toEqual(
      models.map((item) => item.model_name)
    )
  })
})
