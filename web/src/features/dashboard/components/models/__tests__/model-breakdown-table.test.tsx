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
import { render, screen, waitFor } from '@testing-library/react'
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

const MODEL_NAMES = ['gpt-4o', 'claude-3-5-sonnet', 'deepseek-v3']

// The first cell carries the provider icon, whose SVG title is part of the
// cell's text, so the row order is read as the model name it contains.
const rowModels = () =>
  [...document.querySelectorAll('tbody tr')].map((row) =>
    MODEL_NAMES.find((model) => row.textContent?.includes(model))
  )

describe('ModelBreakdownTable', () => {
  it('renders model names and aggregated stats', () => {
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    expect(screen.getByText('gpt-4o')).toBeDefined()
    expect(screen.getByText('claude-3-5-sonnet')).toBeDefined()
    expect(screen.getByText('deepseek-v3')).toBeDefined()
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

  it('orders rows by the field and direction picked in the toolbar control', async () => {
    const user = userEvent.setup()
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    // Quota descending is the initial order.
    expect(rowModels()[0]).toBe('gpt-4o')

    await user.click(screen.getByRole('button', { name: 'Quota' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Requests' }))
    // The control starts descending, so flipping the arrow sorts ascending.
    await user.click(screen.getByRole('button', { name: 'Sort descending' }))

    await waitFor(() => {
      expect(rowModels()).toEqual([
        'claude-3-5-sonnet',
        'gpt-4o',
        'deepseek-v3',
      ])
    })

    await user.click(screen.getByRole('button', { name: 'Requests' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Model' }))

    await waitFor(() => {
      expect(rowModels()).toEqual([
        'claude-3-5-sonnet',
        'deepseek-v3',
        'gpt-4o',
      ])
    })
  })

  it('keeps the column headers plain, as the model square does', () => {
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    for (const name of ['Model', 'Quota', 'Requests', 'Token Count']) {
      const header = screen.getByRole('columnheader', { name })
      expect(header.querySelector('button')).toBeNull()
    }
  })

  it('shows each model’s provider icon instead of one generic icon', () => {
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    expect(screen.getByLabelText('OpenAI')).toBeInTheDocument()
    expect(screen.getByLabelText('Claude')).toBeInTheDocument()
  })

  it('offers the fit-columns and column-visibility controls of the usage logs table', async () => {
    const user = userEvent.setup()
    render(<ModelBreakdownTable data={SAMPLE_DATA} />)

    expect(
      screen.getByRole('button', { name: 'Fit column widths' })
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Quota' })
    ).toBeVisible()
    // The fit action lives on its own toolbar button, so the view menu must not
    // repeat it.
    expect(screen.queryByRole('menuitem', { name: '自适应列宽' })).toBeNull()
  })
})
