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
import type {
  FlowMetric,
  FlowNodeFilter,
  FlowNodeKind,
  FlowQuotaDataItem,
  FlowRole,
} from '@/features/dashboard/types'

import { buildFlowFilterOptions } from './flow'

/**
 * One segment of a 100%-stacked breakdown bar: the share of a single entity
 * (user, token, model, ...) inside its stage.
 */
export type FlowBreakdownSegment = {
  kind: FlowNodeKind
  id: string
  label: string
  value: number
  // 0..1 share of the stage total, ready to multiply by 100 for a width.
  share: number
  color: string
  isOther?: boolean
}

/**
 * A stage is one dimension of the flow. Its segments are always measured under
 * every *other* active filter but never under a filter on its own kind, so the
 * bar keeps showing the full context of the dimension the user is inspecting.
 */
export type FlowBreakdownStage = {
  kind: FlowNodeKind
  total: number
  segments: FlowBreakdownSegment[]
  // Segments folded into the trailing "Other" segment by the display limit.
  hiddenCount: number
}

export type FlowBreakdown = {
  total: number
  stages: FlowBreakdownStage[]
}

type BuildFlowBreakdownOptions = {
  topLimit?: number
  otherLabel?: (kind: FlowNodeKind) => string
  maskSensitive?: boolean
}

const FLOW_BREAKDOWN_MASK = '••••'
const FLOW_BREAKDOWN_OTHER_COLOR = 'rgba(148, 163, 184, 0.55)'

/**
 * Folds the per-stage, cross-filtered node totals produced by
 * `buildFlowFilterOptions` into the stacked-bar model the breakdown chart
 * renders. Cross-filtering is the whole point: each stage is totalled with
 * `selectedNodeFiltersExceptKind` applied by the underlying builder, so
 * selecting a model on one bar narrows every other bar but leaves the model bar
 * itself intact.
 */
export function buildFlowBreakdown(
  rows: FlowQuotaDataItem[],
  metric: FlowMetric,
  role: FlowRole,
  stages: readonly FlowNodeKind[],
  activeFilters: readonly FlowNodeFilter[],
  options: BuildFlowBreakdownOptions = {}
): FlowBreakdown {
  const { nodes } = buildFlowFilterOptions(
    rows,
    metric,
    undefined,
    role,
    [...stages],
    activeFilters
  )
  const topLimit =
    options.topLimit && options.topLimit > 0
      ? options.topLimit
      : Number.MAX_SAFE_INTEGER

  const builtStages: FlowBreakdownStage[] = stages.map((kind) => {
    const ranked = nodes
      .filter((option) => option.kind === kind)
      .sort((a, b) => b.valueRaw - a.valueRaw || a.label.localeCompare(b.label))
    const total = ranked.reduce((sum, option) => sum + option.valueRaw, 0)
    const kept = ranked.slice(0, topLimit)
    const folded = ranked.slice(topLimit)
    const segments: FlowBreakdownSegment[] = kept.map((option) => ({
      kind,
      id: option.value,
      label: options.maskSensitive ? FLOW_BREAKDOWN_MASK : option.label,
      value: option.valueRaw,
      share: total > 0 ? option.valueRaw / total : 0,
      color: option.color,
    }))

    if (folded.length > 0) {
      const foldedValue = folded.reduce(
        (sum, option) => sum + option.valueRaw,
        0
      )
      segments.push({
        kind,
        id: `${kind}:__other__`,
        label: options.otherLabel ? options.otherLabel(kind) : `Other ${kind}`,
        value: foldedValue,
        share: total > 0 ? foldedValue / total : 0,
        color: FLOW_BREAKDOWN_OTHER_COLOR,
        isOther: true,
      })
    }

    return { kind, total, segments, hiddenCount: folded.length }
  })

  return {
    // Every stage totals the same rows under the active cross-filter, so the
    // first stage's total is the overall figure; summing stages would multiply
    // it by the number of dimensions.
    total: builtStages[0]?.total ?? 0,
    stages: builtStages,
  }
}

/**
 * Applies a click on a segment: at most one filter per dimension, and clicking
 * the already-selected segment clears it. Mirrors the cross-filter behaviour of
 * a pivot chart rather than the multi-select of the Sankey node chips.
 */
export function toggleFlowBreakdownFilter(
  filters: readonly FlowNodeFilter[],
  next: FlowNodeFilter
): FlowNodeFilter[] {
  const withoutKind = filters.filter((filter) => filter.kind !== next.kind)
  const alreadyActive = filters.some(
    (filter) => filter.kind === next.kind && filter.id === next.id
  )
  return alreadyActive ? withoutKind : [...withoutKind, next]
}
