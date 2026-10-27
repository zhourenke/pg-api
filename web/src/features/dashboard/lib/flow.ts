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
  FlowFilterOptions,
  FlowMetric,
  FlowNodeFilter,
  FlowNodeKind,
  FlowQuotaDataItem,
  FlowRole,
} from '@/features/dashboard/types'

import { getDashboardChartColors } from './charts'

type FlowMetrics = {
  quota: number
  tokens: number
  requests: number
}

type FlowPathNode = {
  id: string
  label: string
  kind: FlowNodeKind
}

type FlowPathContext = {
  deletedTokenLabel?: (tokenId: number) => string
}

const EMPTY_FLOW_PATH_CONTEXT: FlowPathContext = {}

const DEFAULT_FLOW_ROLE: FlowRole = 'user'

const DEFAULT_FLOW_CHART_COLOR = '#1664FF'

function numberValue(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function rowMetrics(row: FlowQuotaDataItem): FlowMetrics {
  return {
    quota: numberValue(row.quota),
    tokens: numberValue(row.token_used),
    requests: numberValue(row.count),
  }
}

function metricValue(metrics: FlowMetrics, metric: FlowMetric): number {
  if (metric === 'requests') return metrics.requests
  if (metric === 'tokens') return metrics.tokens
  return metrics.quota
}

function userNode(row: FlowQuotaDataItem): FlowPathNode {
  const userID = numberValue(row.user_id)
  return {
    id: userID > 0 ? `user:${userID}` : `user:${row.username || 'unknown'}`,
    label: row.username || (userID > 0 ? `user-${userID}` : 'Unknown User'),
    kind: 'user',
  }
}

function nodeNameNode(row: FlowQuotaDataItem): FlowPathNode {
  const nodeName = row.node_name || 'default-node'
  return {
    id: `node:${nodeName}`,
    label: nodeName,
    kind: 'node',
  }
}

function tokenNode(row: FlowQuotaDataItem, ctx: FlowPathContext): FlowPathNode {
  const tokenID = numberValue(row.token_id)
  return {
    id:
      tokenID > 0 ? `token:${tokenID}` : `token:${row.token_name || 'unknown'}`,
    label: row.token_name || deletedTokenLabel(tokenID, ctx),
    kind: 'token',
  }
}

function deletedTokenLabel(tokenID: number, ctx: FlowPathContext): string {
  if (tokenID <= 0) return 'Unknown Token'
  return ctx.deletedTokenLabel?.(tokenID) ?? `token-${tokenID}`
}

function groupNode(row: FlowQuotaDataItem): FlowPathNode {
  const useGroup = row.use_group || 'unknown'
  return {
    id: `group:${useGroup}`,
    label: useGroup,
    kind: 'group',
  }
}

function modelNode(row: FlowQuotaDataItem): FlowPathNode {
  const model = row.model_name || 'unknown'
  return {
    id: `model:${model}`,
    label: row.model_name || 'Unknown Model',
    kind: 'model',
  }
}

function channelNode(row: FlowQuotaDataItem): FlowPathNode {
  const channelID = numberValue(row.channel_id)
  return {
    id:
      channelID > 0
        ? `channel:${channelID}`
        : `channel:${row.channel_name || 'unknown'}`,
    label:
      row.channel_name || (channelID > 0 ? `channel-${channelID}` : 'Unknown'),
    kind: 'channel',
  }
}

const NODE_BUILDERS: Record<
  FlowNodeKind,
  (row: FlowQuotaDataItem, ctx: FlowPathContext) => FlowPathNode
> = {
  user: userNode,
  node: nodeNameNode,
  token: tokenNode,
  group: groupNode,
  model: modelNode,
  channel: channelNode,
}

const ROLE_FLOW_STAGES: Record<FlowRole, FlowNodeKind[]> = {
  root: ['user', 'node', 'token', 'group', 'model', 'channel'],
  admin: ['user', 'group', 'model', 'channel'],
  user: ['token', 'group', 'model'],
}

// A breakdown needs at least two columns to say anything, so hiding stages can
// never collapse the path below this many columns.
const MIN_FLOW_STAGES = 2

export function getFlowStages(role: FlowRole): FlowNodeKind[] {
  return ROLE_FLOW_STAGES[role] ?? ROLE_FLOW_STAGES.user
}

function resolveVisibleStages(
  role: FlowRole,
  visibleStages?: FlowNodeKind[]
): FlowNodeKind[] {
  const stages = getFlowStages(role)
  if (!visibleStages) return stages
  const visible = new Set(visibleStages)
  const filtered = stages.filter((stage) => visible.has(stage))
  return filtered.length >= MIN_FLOW_STAGES ? filtered : stages
}

function flowPathForStages(
  row: FlowQuotaDataItem,
  stages: FlowNodeKind[],
  ctx: FlowPathContext = EMPTY_FLOW_PATH_CONTEXT
): FlowPathNode[] {
  return stages.map((stage) => NODE_BUILDERS[stage](row, ctx))
}

function colorAt(index: number, palette?: readonly string[]): string {
  const colors =
    palette && palette.length > 0 ? palette : getDashboardChartColors(index + 1)
  if (colors.length === 0) return DEFAULT_FLOW_CHART_COLOR
  return colors[index % colors.length] ?? DEFAULT_FLOW_CHART_COLOR
}

function colorPalette(
  colorCount: number,
  palette?: readonly string[]
): readonly string[] {
  if (palette && palette.length > 0) return palette
  const colors = getDashboardChartColors(colorCount)
  return colors.length > 0 ? colors : [DEFAULT_FLOW_CHART_COLOR]
}

function stableColorMap(
  keys: string[],
  palette?: readonly string[]
): Map<string, string> {
  const map = new Map<string, string>()
  const uniqueKeys = [...new Set(keys)]
  const colors = colorPalette(uniqueKeys.length, palette)
  uniqueKeys.forEach((key, index) => {
    map.set(key, colorAt(index, colors))
  })
  return map
}

function nodeFilterKey(filter: FlowNodeFilter): string {
  return `${filter.kind}\u0000${filter.id}`
}

function normalizeSelectedNodeFilters(
  selectedNodes: readonly FlowNodeFilter[] | undefined,
  stages: readonly FlowNodeKind[]
): Map<FlowNodeKind, Set<string>> {
  const visibleKinds = new Set(stages)
  const filters = new Map<FlowNodeKind, Set<string>>()

  for (const filter of selectedNodes ?? []) {
    if (!visibleKinds.has(filter.kind)) continue
    const selected = filters.get(filter.kind) ?? new Set<string>()
    selected.add(filter.id)
    filters.set(filter.kind, selected)
  }

  return filters
}

function pathMatchesNodeFilters(
  path: FlowPathNode[],
  filters: Map<FlowNodeKind, Set<string>>
): boolean {
  if (filters.size === 0) return true

  const pathNodesByKind = new Map<FlowNodeKind, Set<string>>()
  for (const node of path) {
    const ids = pathNodesByKind.get(node.kind) ?? new Set<string>()
    ids.add(node.id)
    pathNodesByKind.set(node.kind, ids)
  }

  for (const [kind, selectedIds] of filters) {
    const pathIds = pathNodesByKind.get(kind)
    if (!pathIds) return false

    let hasSelectedNode = false
    for (const id of selectedIds) {
      if (pathIds.has(id)) {
        hasSelectedNode = true
        break
      }
    }
    if (!hasSelectedNode) return false
  }

  return true
}

function filterRowsByNodes(
  rows: FlowQuotaDataItem[],
  selectedNodes: readonly FlowNodeFilter[] | undefined,
  stages: FlowNodeKind[],
  ctx: FlowPathContext
): FlowQuotaDataItem[] {
  const filters = normalizeSelectedNodeFilters(selectedNodes, stages)
  if (filters.size === 0) return rows

  return rows.filter((row) =>
    pathMatchesNodeFilters(flowPathForStages(row, stages, ctx), filters)
  )
}

function selectedNodeFiltersExceptKind(
  selectedNodes: readonly FlowNodeFilter[] | undefined,
  kind: FlowNodeKind
): FlowNodeFilter[] | undefined {
  const filtered = (selectedNodes ?? []).filter(
    (filter) => filter.kind !== kind
  )
  return filtered.length > 0 ? filtered : undefined
}

function formatNumber(value: number): string {
  return Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    value
  )
}

function buildUserFilterOptions(
  rows: FlowQuotaDataItem[],
  metric: FlowMetric = 'quota',
  palette?: readonly string[]
): FlowFilterOptions['users'] {
  const users = new Map<
    string,
    {
      label: string
      value: number
      color: string
    }
  >()
  const colors = stableColorMap(
    rows.map((row) => userNode(row).id).sort((a, b) => a.localeCompare(b)),
    palette
  )

  for (const row of rows) {
    const user = userNode(row)
    if (!row.user_id && !row.username) continue
    const metrics = rowMetrics(row)
    const value = metricValue(metrics, metric)
    const current = users.get(user.id) ?? {
      label: user.label,
      value: 0,
      color: colors.get(user.id) ?? colorAt(0, palette),
    }
    current.value += value
    users.set(user.id, current)
  }

  return [...users.entries()]
    .map(([value, user]) => ({
      value,
      label: user.label,
      valueLabel: formatNumber(user.value),
      valueRaw: user.value,
      color: user.color,
    }))
    .sort((a, b) => b.valueRaw - a.valueRaw || a.label.localeCompare(b.label))
}

function buildNodeFilterOptions(
  rows: FlowQuotaDataItem[],
  metric: FlowMetric,
  role: FlowRole,
  visibleStages: FlowNodeKind[] | undefined,
  palette: readonly string[] | undefined,
  ctx: FlowPathContext,
  selectedNodes?: readonly FlowNodeFilter[]
): FlowFilterOptions['nodes'] {
  const stages = resolveVisibleStages(role, visibleStages)
  const stageOrder = new Map(stages.map((stage, index) => [stage, index]))
  const colorIds = new Set<string>()
  for (const row of rows) {
    for (const node of flowPathForStages(row, stages, ctx)) {
      colorIds.add(node.id)
    }
  }

  const colors = stableColorMap(
    [...colorIds].sort((a, b) => a.localeCompare(b)),
    palette
  )
  const options: FlowFilterOptions['nodes'] = []

  for (const stage of stages) {
    const totals = new Map<
      string,
      {
        node: FlowPathNode
        value: number
      }
    >()
    const candidateRows = filterRowsByNodes(
      rows,
      selectedNodeFiltersExceptKind(selectedNodes, stage),
      stages,
      ctx
    )

    for (const row of candidateRows) {
      const metrics = rowMetrics(row)
      const value = metricValue(metrics, metric)
      const node = NODE_BUILDERS[stage](row, ctx)
      const key = nodeFilterKey({ kind: node.kind, id: node.id })
      const current = totals.get(key) ?? { node, value: 0 }
      current.value += value
      totals.set(key, current)
    }

    for (const rank of totals.values()) {
      options.push({
        kind: rank.node.kind,
        value: rank.node.id,
        label: rank.node.label,
        valueLabel: formatNumber(rank.value),
        valueRaw: rank.value,
        color: colors.get(rank.node.id) ?? colorAt(0, palette),
      })
    }
  }

  return options.sort(
    (a, b) =>
      (stageOrder.get(a.kind) ?? 0) - (stageOrder.get(b.kind) ?? 0) ||
      b.valueRaw - a.valueRaw ||
      a.label.localeCompare(b.label) ||
      a.value.localeCompare(b.value)
  )
}

export function buildFlowFilterOptions(
  rows: FlowQuotaDataItem[],
  metric: FlowMetric = 'quota',
  palette?: readonly string[],
  role: FlowRole = DEFAULT_FLOW_ROLE,
  visibleStages?: FlowNodeKind[],
  selectedNodes?: readonly FlowNodeFilter[]
): FlowFilterOptions {
  return {
    users: buildUserFilterOptions(rows, metric, palette),
    nodes: buildNodeFilterOptions(
      rows,
      metric,
      role,
      visibleStages,
      palette,
      EMPTY_FLOW_PATH_CONTEXT,
      selectedNodes
    ),
  }
}
