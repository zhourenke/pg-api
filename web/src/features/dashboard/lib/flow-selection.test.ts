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
import { describe, expect, test } from 'vitest'

import { requireSuccessfulFlowRows } from './flow-selection'

describe('dashboard flow response handling', () => {
  test('throws unsuccessful flow responses instead of treating them as empty data', () => {
    expect(() =>
      requireSuccessfulFlowRows(
        { success: false, data: [], message: 'database unavailable' },
        'Failed to load'
      )
    ).toThrow(/database unavailable/)
    expect(
      requireSuccessfulFlowRows(
        { success: true, data: [{ user_id: 1, quota: 10 }] },
        'Failed to load'
      )
    ).toEqual([{ user_id: 1, quota: 10 }])
  })
})
