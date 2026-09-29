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

import {
  formatLatency,
  formatThroughput,
  formatUptimePct,
  getSuccessRateLevel,
} from '../lib/format'

describe('formatLatency', () => {
  it('keeps a space between the value and its unit', () => {
    expect(formatLatency(9_080)).toBe('9.08 s')
    expect(formatLatency(1_200)).toBe('1.20 s')
    expect(formatLatency(250)).toBe('250 ms')
  })

  it('reports a missing measurement instead of a zero latency', () => {
    expect(formatLatency(0)).toBe('—')
    expect(formatLatency(Number.NaN)).toBe('—')
  })
})

describe('formatThroughput', () => {
  it('keeps a space between the value and its unit', () => {
    expect(formatThroughput(147.4)).toBe('147.4 t/s')
    expect(formatThroughput(9.5)).toBe('9.50 t/s')
    expect(formatThroughput(1_474)).toBe('1.5K t/s')
  })

  it('reports a missing measurement instead of zero throughput', () => {
    expect(formatThroughput(0)).toBe('—')
    expect(formatThroughput(Number.NaN)).toBe('—')
  })
})

describe('formatUptimePct', () => {
  it('writes percentages without a space before the sign', () => {
    expect(formatUptimePct(98.22)).toBe('98.22%')
    expect(formatUptimePct(100)).toBe('100.00%')
    expect(formatUptimePct(Number.NaN)).toBe('—')
  })
})

describe('getSuccessRateLevel', () => {
  it('grades the thresholds the card strip colours depend on', () => {
    expect(getSuccessRateLevel(100)).toBe('excellent')
    expect(getSuccessRateLevel(99.99)).toBe('good')
    expect(getSuccessRateLevel(89.99)).toBe('warning')
    expect(getSuccessRateLevel(69.99)).toBe('critical')
    expect(getSuccessRateLevel(Number.NaN)).toBe('unknown')
  })
})
