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
import z from 'zod'

import { TIME_WINDOW_IDS } from '@/lib/time-window'

import type { AuditFilters } from '../api'

/** Rows per page the audit table opens with. */
const DEFAULT_PAGE_SIZE = 20

/**
 * The audit filters as they live in the address bar and the two functions that
 * translate between that shape and `AuditFilters` are the only place the two
 * spellings meet: the URL keeps the camelCase names the rest of the app uses,
 * the API takes the snake_case query parameters.
 *
 * Search values reach the schema already JSON parsed, so the result filter is
 * kept as a boolean in the URL (`?success=false`) while the API takes the
 * string the filter bar produces; a quoted string is accepted too so an older
 * link still resolves.
 */
const successParam = z
  .union([z.boolean(), z.string()])
  .transform((value) => (typeof value === 'boolean' ? value : value === 'true'))
  .optional()
  .catch(undefined)

export const auditSearchSchema = z.object({
  page: z.number().optional().catch(1),
  pageSize: z.number().optional().catch(DEFAULT_PAGE_SIZE),
  startTime: z.number().optional(),
  endTime: z.number().optional(),
  preset: z.enum(TIME_WINDOW_IDS).optional().catch(undefined),
  success: successParam,
  category: z.string().optional().catch(undefined),
  tokenRef: z.string().optional().catch(undefined),
  excludeTokenRef: z.string().optional().catch(undefined),
  username: z.string().optional().catch(undefined),
  requestId: z.string().optional().catch(undefined),
})

export type AuditSearchParams = z.infer<typeof auditSearchSchema>

export function auditFiltersFromSearch(
  search: AuditSearchParams
): AuditFilters {
  return {
    p: search.page ?? 1,
    page_size: search.pageSize ?? DEFAULT_PAGE_SIZE,
    start_timestamp: search.startTime,
    end_timestamp: search.endTime,
    preset: search.preset,
    success: search.success === undefined ? undefined : String(search.success),
    category: search.category,
    token_ref: search.tokenRef,
    exclude_token_ref: search.excludeTokenRef,
    username: search.username,
    request_id: search.requestId,
  }
}

/** Defaults are left out so a shared link only carries what was chosen. */
export function buildAuditSearchParams(
  filters: AuditFilters
): AuditSearchParams {
  return {
    page: filters.p === 1 ? undefined : filters.p,
    pageSize:
      filters.page_size === DEFAULT_PAGE_SIZE ? undefined : filters.page_size,
    startTime: filters.start_timestamp,
    endTime: filters.end_timestamp,
    preset: filters.preset,
    success:
      filters.success === undefined ? undefined : filters.success === 'true',
    category: filters.category,
    tokenRef: filters.token_ref,
    excludeTokenRef: filters.exclude_token_ref,
    username: filters.username,
    requestId: filters.request_id,
  }
}
