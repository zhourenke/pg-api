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

import { getTokensPerSecond } from '../format'

describe('generation throughput', () => {
  test('excludes the first-token wait for a streamed reply', () => {
    // 500 tokens over the 8s generation window, not over the 10s duration
    expect(getTokensPerSecond(10, 500, 2000, true)).toBe(62.5)
  })

  test('uses the whole duration for a non-streamed reply', () => {
    // A non-streamed reply has no separate wait before its output
    expect(getTokensPerSecond(10, 500, 2000, false)).toBe(50)
  })

  test('falls back to the whole duration when no first-token time was recorded', () => {
    expect(getTokensPerSecond(10, 500, undefined, true)).toBe(50)
    // The backend writes -1000 for a request that never sent a first token
    expect(getTokensPerSecond(10, 500, -1000, true)).toBe(50)
    expect(getTokensPerSecond(10, 500, 0, true)).toBe(50)
  })

  test('falls back when the first-token time covers the whole measured duration', () => {
    // The log stores whole seconds, so a 58s first token in a 58s reply leaves
    // no generation window to divide by
    expect(getTokensPerSecond(58, 800, 58000, true)).toBeCloseTo(13.79, 2)
  })

  test('reports nothing without output tokens or a measured duration', () => {
    expect(getTokensPerSecond(0, 500, 2000, true)).toBeNull()
    expect(getTokensPerSecond(10, 0, 2000, true)).toBeNull()
  })
})
