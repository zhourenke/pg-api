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

import type { Channel } from '../../types'
import { aggregateChannelsByTag } from '../channel-utils'

function makeChannel(id: number, over: Partial<Channel> = {}): Channel {
  return {
    id,
    key: `key-${id}`,
    name: `channel-${id}`,
    tag: 'Command',
    group: 'default',
    status: 1,
    priority: 0,
    weight: 0,
    used_quota: 0,
    response_time: 0,
    balance: 0,
    models: '',
    ...over,
  } as unknown as Channel
}

describe('tag aggregation', () => {
  it('reports the priority and weight every channel shares', () => {
    const [row] = aggregateChannelsByTag([
      makeChannel(1, { priority: 3, weight: 7 }),
      makeChannel(2, { priority: 3, weight: 7 }),
    ])

    expect(row.priority).toBe(3)
    expect(row.weight).toBe(7)
  })

  it('reports no value when the channels disagree', () => {
    const [row] = aggregateChannelsByTag([
      makeChannel(1, { priority: 0, weight: 0 }),
      makeChannel(2, { priority: 5, weight: 7 }),
    ])

    expect(row.priority).toBeNull()
    expect(row.weight).toBeNull()
  })

  it('reports a shared -1 as the value it is', () => {
    const [row] = aggregateChannelsByTag([
      makeChannel(1, { priority: -1 }),
      makeChannel(2, { priority: -1 }),
    ])

    expect(row.priority).toBe(-1)
  })

  it('finds the disagreement whichever order the -1 falls in', () => {
    // -1 is a legal priority and used to double as the "nothing seen yet"
    // marker, so a group of -1 and 5 reported 5 when the -1 came first and a
    // disagreement when it came last.
    for (const [first, second] of [
      [-1, 5],
      [5, -1],
    ]) {
      const [row] = aggregateChannelsByTag([
        makeChannel(1, { priority: first }),
        makeChannel(2, { priority: second }),
      ])

      expect(row.priority).toBeNull()
    }
  })

  it('keeps tags apart and still sums and averages within each of them', () => {
    const rows = aggregateChannelsByTag([
      makeChannel(1, { tag: 'Command', used_quota: 10, response_time: 2 }),
      makeChannel(2, { tag: 'Command', used_quota: 20, response_time: 4 }),
      makeChannel(3, { tag: 'Gemini', priority: 9, used_quota: 5 }),
    ])

    expect(rows).toHaveLength(2)
    const command = rows[0]
    expect(command.used_quota).toBe(30)
    expect(command.response_time).toBe(3)
    expect(command.priority).toBe(0)
    const gemini = rows[1]
    expect(gemini.used_quota).toBe(5)
    expect(gemini.priority).toBe(9)
  })
})
