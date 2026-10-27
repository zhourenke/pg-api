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

import type { FlowQuotaDataItem } from '@/features/dashboard/types'

import {
  buildFlowBreakdown,
  toggleFlowBreakdownFilter,
} from '../flow-breakdown'

const STAGES = ['token', 'group', 'model'] as const

const ROWS: FlowQuotaDataItem[] = [
  {
    token_id: 1,
    token_name: 'tok-a',
    use_group: 'default',
    model_name: 'gpt-4o',
    quota: 60,
  },
  {
    token_id: 1,
    token_name: 'tok-a',
    use_group: 'default',
    model_name: 'gpt-4o-mini',
    quota: 20,
  },
  {
    token_id: 2,
    token_name: 'tok-b',
    use_group: 'vip',
    model_name: 'gpt-4o',
    quota: 20,
  },
]

function stageValues(
  breakdown: ReturnType<typeof buildFlowBreakdown>,
  kind: string
) {
  const stage = breakdown.stages.find((item) => item.kind === kind)
  return stage?.segments.map((segment) => segment.value) ?? []
}

describe('buildFlowBreakdown', () => {
  it('splits each stage into shares that sum to the stage total', () => {
    const breakdown = buildFlowBreakdown(ROWS, 'quota', 'user', STAGES, [])

    expect(breakdown.total).toBe(100)
    expect(stageValues(breakdown, 'token')).toEqual([80, 20])
    expect(stageValues(breakdown, 'group')).toEqual([80, 20])
    expect(stageValues(breakdown, 'model')).toEqual([80, 20])

    const tokenStage = breakdown.stages.find((item) => item.kind === 'token')
    expect(tokenStage?.segments[0]?.share).toBeCloseTo(0.8)
    expect(tokenStage?.segments[1]?.share).toBeCloseTo(0.2)
  })

  it('narrows other stages by the active filter but keeps the filtered stage whole', () => {
    const breakdown = buildFlowBreakdown(ROWS, 'quota', 'user', STAGES, [
      { kind: 'model', id: 'model:gpt-4o' },
    ])

    // The model stage ignores its own filter, so both models stay listed.
    expect(stageValues(breakdown, 'model')).toEqual([80, 20])
    // Every other stage is restricted to the rows that use gpt-4o.
    expect(stageValues(breakdown, 'token')).toEqual([60, 20])
    expect(stageValues(breakdown, 'group')).toEqual([60, 20])
  })

  it('folds segments past the display limit into a trailing Other slice', () => {
    const breakdown = buildFlowBreakdown(ROWS, 'quota', 'user', STAGES, [], {
      topLimit: 1,
    })

    const modelStage = breakdown.stages.find((item) => item.kind === 'model')
    expect(modelStage?.segments).toHaveLength(2)
    expect(modelStage?.segments[0]?.value).toBe(80)
    expect(modelStage?.segments[1]?.isOther).toBe(true)
    expect(modelStage?.segments[1]?.value).toBe(20)
    expect(modelStage?.hiddenCount).toBe(1)
  })

  it('masks segment labels when sensitive data is hidden', () => {
    const breakdown = buildFlowBreakdown(ROWS, 'quota', 'user', STAGES, [], {
      maskSensitive: true,
    })

    const labels = breakdown.stages.flatMap((stage) =>
      stage.segments.map((segment) => segment.label)
    )
    expect(labels.every((label) => label === '••••')).toBe(true)
  })
})

describe('toggleFlowBreakdownFilter', () => {
  it('keeps a single filter per dimension and replaces it on a new pick', () => {
    const once = toggleFlowBreakdownFilter([], {
      kind: 'model',
      id: 'model:gpt-4o',
    })
    expect(once).toEqual([{ kind: 'model', id: 'model:gpt-4o' }])

    const replaced = toggleFlowBreakdownFilter(once, {
      kind: 'model',
      id: 'model:gpt-4o-mini',
    })
    expect(replaced).toEqual([{ kind: 'model', id: 'model:gpt-4o-mini' }])
  })

  it('clears a dimension when its own segment is picked again', () => {
    const active = [{ kind: 'model' as const, id: 'model:gpt-4o' }]
    expect(
      toggleFlowBreakdownFilter(active, { kind: 'model', id: 'model:gpt-4o' })
    ).toEqual([])
  })

  it('keeps filters of different dimensions side by side', () => {
    const withToken = toggleFlowBreakdownFilter([], {
      kind: 'token',
      id: 'token:1',
    })
    const withGroup = toggleFlowBreakdownFilter(withToken, {
      kind: 'group',
      id: 'group:default',
    })
    expect(withGroup).toEqual([
      { kind: 'token', id: 'token:1' },
      { kind: 'group', id: 'group:default' },
    ])
  })
})
