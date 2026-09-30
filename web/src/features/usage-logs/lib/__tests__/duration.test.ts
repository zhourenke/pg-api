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

import { formatUseTimeMs } from '@/lib/format'

import { getLogDurationMs } from '../format'

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

describe('formatUseTimeMs', () => {
  test('keeps millisecond resolution below one minute', () => {
    expect(formatUseTimeMs(28_035)).toBe('28.035s')
    expect(formatUseTimeMs(28_000)).toBe('28.000s')
  })

  test('switches to minutes and seconds at one minute and above', () => {
    expect(formatUseTimeMs(90_400)).toBe('1m 30s')
  })
})
