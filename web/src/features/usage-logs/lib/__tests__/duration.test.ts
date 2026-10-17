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

import { formatUseTime } from '@/lib/format'

import { getLogDurationMs, getOutputDurationMs } from '../format'

describe('getLogDurationMs', () => {
  test('uses the recorded millisecond duration when the log has one', () => {
    expect(getLogDurationMs({ use_time: 28 }, { use_time_ms: 28_035 })).toBe(
      28_035
    )
  })

  test('falls back to the whole-second column for logs without use_time_ms', () => {
    expect(getLogDurationMs({ use_time: 28 }, { frt: 2000 })).toBe(28_000)
    expect(getLogDurationMs({ use_time: 28 }, null)).toBe(28_000)
  })

  test('ignores a non-positive millisecond duration', () => {
    expect(getLogDurationMs({ use_time: 5 }, { use_time_ms: 0 })).toBe(5000)
  })
})

describe('getOutputDurationMs', () => {
  test('subtracts the first-token latency from a streamed duration', () => {
    expect(getOutputDurationMs(10_300, 2000, true)).toBe(8300)
    expect(getOutputDurationMs(28_000, 2000, true)).toBe(26_000)
  })

  test('keeps the whole duration for non-streamed logs and missing latencies', () => {
    expect(getOutputDurationMs(28_000, 2000, false)).toBe(28_000)
    expect(getOutputDurationMs(28_000, undefined, true)).toBe(28_000)
    // The backend records -1000 when a stream ended before its first token.
    expect(getOutputDurationMs(28_000, -1000, true)).toBe(28_000)
  })

  test('falls back to the whole duration when the latency covers it', () => {
    expect(getOutputDurationMs(58_000, 58_000, true)).toBe(58_000)
    expect(getOutputDurationMs(9_000, 10_000, true)).toBe(9_000)
  })
})

describe('formatUseTime', () => {
  test('writes seconds with one decimal and a space before the unit', () => {
    expect(formatUseTime(1.24)).toBe('1.2 s')
    expect(formatUseTime(28.035)).toBe('28.0 s')
    expect(formatUseTime(0)).toBe('0.0 s')
  })

  test('keeps the seconds shape past one minute instead of switching to minutes', () => {
    expect(formatUseTime(90.4)).toBe('90.4 s')
    expect(formatUseTime(187.34)).toBe('187.3 s')
  })

  test('formats durations less than 0.1s as <0.1 s', () => {
    expect(formatUseTime(0.036)).toBe('<0.1 s')
    expect(formatUseTime(0.099)).toBe('<0.1 s')
    expect(formatUseTime(0.1)).toBe('0.1 s')
  })
})
