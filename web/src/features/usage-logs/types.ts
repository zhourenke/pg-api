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
 * Type definitions for usage logs
 */
import type { RequestRuleTrace } from '@/features/pricing/lib/billing-expr'
import type { PolicyEvent } from '@/features/system-settings/request-policies/api'
import type { TimeWindowId } from '@/lib/time-window'

import type { UsageLog } from './data/schema'

// ============================================================================
// Filter Types
// ============================================================================

/**
 * Common logs filters
 */
export interface CommonLogFilters {
  startTime?: Date
  endTime?: Date
  /** The preset behind the range, so a calendar window can be recomputed. */
  preset?: TimeWindowId
  channel?: string
  model?: string
  token?: string
  group?: string
  username?: string
  requestId?: string
  upstreamRequestId?: string
}

// ============================================================================
// Common Logs Additional Types
// ============================================================================

/**
 * Parsed data from the 'other' field in usage logs
 */
export interface ChannelAffinityInfo {
  rule_name?: string
  selected_group?: string
  key_source?: string
  key_path?: string
  key_key?: string
  key_hint?: string
  key_fp?: string
  using_group?: string
}

export const USAGE_BILLING_PATH = {
  LOCAL: 'local',
  UPSTREAM: 'upstream',
  OPENAI: 'billing-usage-openai',
  OPENAI_ESTIMATED: 'billing-usage-openai-estimated',
  ANTHROPIC: 'billing-usage-anthropic',
  ANTHROPIC_ESTIMATED: 'billing-usage-anthropic-estimated',
  GEMINI: 'billing-usage-gemini',
  GEMINI_ESTIMATED: 'billing-usage-gemini-estimated',
} as const

type UsageBillingPath =
  (typeof USAGE_BILLING_PATH)[keyof typeof USAGE_BILLING_PATH]

interface ToolSurchargeItem {
  name: string
  count: number
  price: number
}

export interface LogOtherData {
  admin_info?: {
    request_policy?: PolicyEvent[]
    is_multi_key?: boolean
    multi_key_index?: number
    use_channel?: number[]
    local_count_tokens?: boolean
    usage_billing_path?: UsageBillingPath | string
    channel_affinity?: ChannelAffinityInfo
    // Top-up audit fields (type=1, admin only)
    payment_method?: string
    callback_payment_method?: string
    caller_ip?: string
    server_ip?: string
    version?: string
    node_name?: string
    // Operator identity for audit logs (type=3, admin only)
    admin_username?: string
    admin_id?: number | string
    admin_role?: number
    auth_method?: 'session' | 'access_token' | string
    // Quota saturation marker: set when a quota conversion clamped at the
    // supported single-request bound (overflow/underflow) or hit a NaN fallback while computing
    // this request's charge. Admin-only (nested under admin_info).
    quota_saturation?: {
      op: string
      kind: 'overflow' | 'underflow' | 'nan'
      original: number
      clamped: number
    }
    // Reject / intercept reason (admin only)
    reject_reason?: string
  }
  // Language-independent operation descriptor (audit/login logs).
  // Frontend renders localized content from action + params via i18n templates.
  op?: {
    action?: string
    params?: Record<string, string | number | boolean | string[]>
  }
  // Operation audit details written by the admin-audit fallback in authHelper (type=3, admin only)
  audit_info?: {
    method?: string
    route?: string
    path?: string
    status?: number
    success?: boolean
    params?: Record<string, string>
  }
  // Login audit fields (type=7); visible to the log owner
  login_method?: string
  user_agent?: string
  request_path?: string
  request_conversion?: string[]
  ws?: boolean
  audio?: boolean
  audio_input?: number
  audio_output?: number
  text_input?: number
  text_output?: number
  cache_tokens?: number
  image_cache_tokens?: number
  billing_tokens?: Record<string, number>
  cache_creation_tokens?: number
  cache_creation_tokens_5m?: number
  cache_creation_tokens_1h?: number
  claude?: boolean
  model_ratio?: number
  completion_ratio?: number
  model_price?: number
  group_ratio?: number
  user_group_ratio?: number
  cache_ratio?: number
  cache_creation_ratio?: number
  cache_creation_ratio_5m?: number
  cache_creation_ratio_1h?: number
  is_model_mapped?: boolean
  upstream_model_name?: string
  // Diagnostic only. Whether the names disagree is derived in the UI via
  // isResponseModelMismatch so old rows follow the current comparison rule.
  response_model?: {
    requested_model: string
    upstream_model: string
    returned_model: string
  }
  audio_ratio?: number
  audio_completion_ratio?: number
  frt?: number
  // Millisecond-precision request duration. The stored use_time only carries
  // whole seconds, which is too coarse to derive throughput from; older logs
  // omit this and the UI falls back to use_time.
  use_time_ms?: number
  // Tiered (expression-based) billing fields, set by backend when
  // billing_mode === 'tiered_expr'. expr_b64 is the base64-encoded billing
  // expression; the matched tier and request-rule traces come from the actual
  // settlement run.
  billing_mode?: string
  billing_unit?: 'token' | 'request'
  fixed_price?: number
  image_count?: number
  expr_b64?: string
  matched_tier?: string
  request_rules?: RequestRuleTrace[]
  reasoning_effort?: string
  reasoning_tokens?: number
  image?: boolean
  image_ratio?: number
  image_output?: number
  web_search?: boolean
  web_search_call_count?: number
  web_search_price?: number
  file_search?: boolean
  file_search_call_count?: number
  file_search_price?: number
  tool_surcharges?: ToolSurchargeItem[]
  audio_input_seperate_price?: boolean
  audio_input_token_count?: number
  audio_input_price?: number
  image_generation_call?: boolean
  image_generation_call_price?: number
  image_generation_call_count?: number
  is_system_prompt_overwritten?: boolean
  po?: string[]
  group?: string
  stream_status?: {
    status?: string
    end_reason?: string
    error_count?: number
    end_error?: string
    errors?: string[]
  }
  // Violation fee fields
  violation_fee?: boolean
  violation_fee_code?: string
  violation_fee_marker?: string
  fee_quota?: number
  // Refund reason (type=6)
  reason?: string
}

/**
 * Log statistics data
 */
export interface LogStatistics {
  quota: number
  rpm: number
  tpm: number
}

// ============================================================================
// Common Log Types
// ============================================================================

export interface GetLogsParams {
  p?: number
  page_size?: number
  type?: number
  username?: string
  token_name?: string
  model_name?: string
  start_timestamp?: number
  end_timestamp?: number
  channel?: number
  group?: string
  request_id?: string
  upstream_request_id?: string
}

export interface GetLogsResponse {
  success: boolean
  message?: string
  data?: {
    items: UsageLog[]
    total: number
    page: number
    page_size: number
  }
}

export interface GetLogStatsParams {
  type?: number
  username?: string
  token_name?: string
  model_name?: string
  start_timestamp?: number
  end_timestamp?: number
  channel?: number
  group?: string
  request_id?: string
  upstream_request_id?: string
}

export interface GetLogStatsResponse {
  success: boolean
  message?: string
  data?: LogStatistics
}

// ============================================================================
// User Info Types
// ============================================================================

export interface UserInfo {
  id: number
  username: string
  display_name?: string
  quota: number
  used_quota: number
  request_count: number
  group?: string
  aff_code?: string
  aff_count?: number
  aff_quota?: number
  remark?: string
}
