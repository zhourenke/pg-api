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
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import type { QuotaDataItem } from '@/features/dashboard/types'

import { ModelBreakdownTable } from '../model-breakdown-table'

const SAMPLE_DATA: QuotaDataItem[] = [
  {
    model_name: 'gpt-4o',
    quota: 500000,
    count: 100,
    token_used: 100000,
    created_at: 1000,
  },
  {
    model_name: 'claude-3-5-sonnet',
    quota: 300000,
    count: 50,
    token_used: 50000,
    created_at: 1000,
  },
  {
    model_name: 'deepseek-v3',
    quota: 200000,
    count: 200,
    token_used: 80000,
    created_at: 1000,
  },
]

describe('ModelBreakdownTable', () => {
  it('renders model names and aggregated stats', () => {
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    expect(screen.getByText('gpt-4o')).toBeDefined()
    expect(screen.getByText('claude-3-5-sonnet')).toBeDefined()
    expect(screen.getByText('deepseek-v3')).toBeDefined()

    // 3 models total
    expect(screen.getByText('3 models')).toBeDefined()
  })

  it('filters rows based on search input', async () => {
    const user = userEvent.setup()
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    const searchInput = screen.getByPlaceholderText('Search models...')
    await user.type(searchInput, 'claude')

    expect(screen.getByText('claude-3-5-sonnet')).toBeDefined()
    expect(screen.queryByText('gpt-4o')).toBeNull()
    expect(screen.queryByText('deepseek-v3')).toBeNull()
  })

  it('handles empty data gracefully', () => {
    render(<ModelBreakdownTable data={[]} />)
    expect(screen.getByText('No data available')).toBeDefined()
  })
})
