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

import { usageLogSchema, type UsageLog } from '../../data/schema'
import { getTokensPerSecond } from '../format'

function log(overrides: Partial<UsageLog> = {}): UsageLog {
  return usageLogSchema.parse({
    id: 1,
    user_id: 2,
    created_at: 1788840000,
    type: 2,
    content: '',
    ...overrides,
  })
}

describe('generation throughput', () => {
  test('excludes the first-token wait for a streamed reply', () => {
    // 500 tokens over the 8s generation window, not over the 10s duration
    expect(
      getTokensPerSecond(log({ is_stream: true, completion_tokens: 500 }), {
        frt: 2000,
        use_time_ms: 10_000,
      })
    ).toBe(62.5)
  })

  test('prefers the millisecond duration when the log carries one', () => {
    // use_time only says 10s; the generation window is 10.3s - 2s = 8.3s
    const streamed = log({
      is_stream: true,
      completion_tokens: 500,
      use_time: 10,
    })
    expect(
      getTokensPerSecond(streamed, { frt: 2000, use_time_ms: 10_300 })
    ).toBeCloseTo(60.24, 2)
  })

  test('falls back to whole-second use_time for logs without a millisecond duration', () => {
    // Logs written before use_time_ms existed must keep working
    expect(
      getTokensPerSecond(
        log({ is_stream: true, completion_tokens: 500, use_time: 10 }),
        { frt: 2000 }
      )
    ).toBe(62.5)
  })

  test('uses the whole duration for a non-streamed reply', () => {
    // A non-streamed reply has no separate wait before its output
    expect(
      getTokensPerSecond(log({ completion_tokens: 500 }), {
        frt: 2000,
        use_time_ms: 10_000,
      })
    ).toBe(50)
  })

  test('falls back when no first-token time was recorded', () => {
    const streamed = log({ is_stream: true, completion_tokens: 500 })
    // The backend writes -1000 for a request that never sent a first token
    expect(
      getTokensPerSecond(streamed, { frt: -1000, use_time_ms: 10_000 })
    ).toBe(50)
    expect(getTokensPerSecond(streamed, { use_time_ms: 10_000 })).toBe(50)
  })

  test('falls back when the first-token time covers the whole measured duration', () => {
    expect(
      getTokensPerSecond(log({ is_stream: true, completion_tokens: 800 }), {
        frt: 58_000,
        use_time_ms: 58_000,
      })
    ).toBeCloseTo(13.79, 2)
  })

  test('reports nothing without output tokens or a measured duration', () => {
    expect(
      getTokensPerSecond(log({ completion_tokens: 0 }), {
        use_time_ms: 10_000,
      })
    ).toBeNull()
    expect(
      getTokensPerSecond(log({ completion_tokens: 500, use_time: 0 }), null)
    ).toBeNull()
  })

  test('burst delivery with tiny output window falls back to total duration', () => {
    // 130 tokens over 62ms burst window falls back to total duration (5448ms) -> ~23.86 t/s
    expect(
      getTokensPerSecond(
        log({ is_stream: true, completion_tokens: 130, use_time: 5448, frt: 5386 })
      )
    ).toBeCloseTo(23.86, 2)
  })

  test('subtracts reasoning tokens from completion tokens during output window', () => {
    // 500 total completion tokens, 300 reasoning tokens -> 200 content tokens over 5s -> 40 t/s
    expect(
      getTokensPerSecond(
        log({ is_stream: true, completion_tokens: 500, use_time: 10_000, frt: 5000 }),
        { reasoning_tokens: 300 }
      )
    ).toBe(40)
  })
})
