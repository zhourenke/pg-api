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

import type { AuditFilters } from '../../api'
import {
  auditFiltersFromSearch,
  auditSearchSchema,
  buildAuditSearchParams,
} from '../search-params'

const EMPTY: AuditFilters = { p: 1, page_size: 20 }

describe('audit filters in the address bar', () => {
  it('omits the defaults and keeps every chosen filter', () => {
    const search = buildAuditSearchParams({
      ...EMPTY,
      p: 3,
      page_size: 50,
      start_timestamp: 1788192000,
      end_timestamp: 1790783999,
      preset: 'this-month',
      success: 'false',
      category: 'security',
      token_ref: 'abc',
      username: 'alice',
      request_id: 'req-1',
    })

    expect(search).toEqual({
      page: 3,
      pageSize: 50,
      startTime: 1788192000,
      endTime: 1790783999,
      preset: 'this-month',
      success: false,
      category: 'security',
      tokenRef: 'abc',
      excludeTokenRef: undefined,
      username: 'alice',
      requestId: 'req-1',
    })
  })

  it('writes nothing for the default page', () => {
    expect(buildAuditSearchParams(EMPTY)).toEqual({
      page: undefined,
      pageSize: undefined,
      startTime: undefined,
      endTime: undefined,
      preset: undefined,
      success: undefined,
      category: undefined,
      tokenRef: undefined,
      excludeTokenRef: undefined,
      username: undefined,
      requestId: undefined,
    })
  })

  it('restores the defaults a bare URL leaves out', () => {
    expect(auditFiltersFromSearch(auditSearchSchema.parse({}))).toEqual(EMPTY)
  })

  it('survives a round trip through the URL', () => {
    const filters: AuditFilters = {
      p: 4,
      page_size: 100,
      start_timestamp: 1788192000,
      end_timestamp: 1790783999,
      preset: 'last-month',
      success: 'true',
      category: 'operation',
      token_ref: 'abc',
      exclude_token_ref: 'def',
      username: 'alice',
      request_id: 'req-1',
    }

    expect(
      auditFiltersFromSearch(
        auditSearchSchema.parse(buildAuditSearchParams(filters))
      )
    ).toEqual(filters)
  })

  it('reads the result filter whether it arrives bare or quoted', () => {
    // `?success=false` is JSON parsed into a boolean before the schema sees it,
    // and an earlier link wrote the same filter as a quoted string; both mean
    // "failed", and the page writes the bare form back.
    expect(
      auditFiltersFromSearch(auditSearchSchema.parse({ success: false }))
        .success
    ).toBe('false')
    expect(
      auditFiltersFromSearch(auditSearchSchema.parse({ success: 'false' }))
        .success
    ).toBe('false')
    expect(
      auditFiltersFromSearch(auditSearchSchema.parse({ success: true })).success
    ).toBe('true')
    expect(buildAuditSearchParams({ ...EMPTY, success: 'true' }).success).toBe(
      true
    )
  })

  it('drops a preset that is no longer one of the windows', () => {
    const parsed = auditSearchSchema.parse({
      preset: 'last-century',
      startTime: 1,
      endTime: 2,
    })

    expect(auditFiltersFromSearch(parsed)).toEqual({
      p: 1,
      page_size: 20,
      start_timestamp: 1,
      end_timestamp: 2,
      preset: undefined,
      success: undefined,
      category: undefined,
      token_ref: undefined,
      exclude_token_ref: undefined,
      username: undefined,
      request_id: undefined,
    })
  })
})
