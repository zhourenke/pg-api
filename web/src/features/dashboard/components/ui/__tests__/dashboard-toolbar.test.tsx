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
import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_DASHBOARD_CHART_PREFERENCES } from '@/features/dashboard/constants'
import type { DashboardFilters } from '@/features/dashboard/types'

import { DashboardToolbar } from '../dashboard-toolbar'

const SECTION_META = {
  overview: { titleKey: 'Overview' },
  models: { titleKey: 'Model Call Analytics' },
  flow: { titleKey: 'Flow' },
  users: { titleKey: 'User Analytics' },
}

describe('DashboardToolbar', () => {
  it('renders primary time presets and triggers onFilterChange when clicked', async () => {
    const user = userEvent.setup()
    const onFilterChange = vi.fn()
    const onResetFilters = vi.fn()
    const onSectionChange = vi.fn()
    const onChartPreferencesChange = vi.fn()

    const filters: DashboardFilters = {
      preset: '24h',
      time_granularity: 'hour',
    }

    render(
      <DashboardToolbar
        currentFilters={filters}
        onFilterChange={onFilterChange}
        onResetFilters={onResetFilters}
        activeSection='models'
        visibleSections={['models', 'flow', 'users']}
        sectionMeta={SECTION_META}
        onSectionChange={onSectionChange}
        chartPreferences={DEFAULT_DASHBOARD_CHART_PREFERENCES}
        onChartPreferencesChange={onChartPreferencesChange}
      />
    )

    // Verify 7d preset chip is rendered
    const preset7d = screen.getByRole('button', { name: '7 Days' })
    expect(preset7d).toBeDefined()

    await user.click(preset7d)
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({
        preset: '7d',
        time_granularity: 'hour',
      })
    )
  })

  it('renders active username filter and triggers clear', async () => {
    const user = userEvent.setup()
    const onFilterChange = vi.fn()
    const onResetFilters = vi.fn()
    const onSectionChange = vi.fn()
    const onChartPreferencesChange = vi.fn()

    const filters: DashboardFilters = {
      preset: '7d',
      username: 'alice',
      time_granularity: 'day',
    }

    render(
      <DashboardToolbar
        currentFilters={filters}
        onFilterChange={onFilterChange}
        onResetFilters={onResetFilters}
        activeSection='models'
        visibleSections={['models', 'flow']}
        sectionMeta={SECTION_META}
        onSectionChange={onSectionChange}
        chartPreferences={DEFAULT_DASHBOARD_CHART_PREFERENCES}
        onChartPreferencesChange={onChartPreferencesChange}
      />
    )

    expect(screen.getByText('alice')).toBeDefined()

    // Click reset button
    const resetButtons = screen.getAllByTitle('Reset')
    expect(resetButtons.length).toBeGreaterThan(0)
    await user.click(resetButtons[0])
    expect(onResetFilters).toHaveBeenCalled()
  })

  it('does not render redundant preferences or filter modal buttons in the toolbar', () => {
    const filters: DashboardFilters = { preset: '7d' }

    render(
      <DashboardToolbar
        currentFilters={filters}
        onFilterChange={vi.fn()}
        onResetFilters={vi.fn()}
        activeSection='models'
        visibleSections={['models', 'flow', 'users']}
        sectionMeta={SECTION_META}
        onSectionChange={vi.fn()}
        chartPreferences={DEFAULT_DASHBOARD_CHART_PREFERENCES}
        onChartPreferencesChange={vi.fn()}
      />
    )

    expect(
      screen.queryByRole('button', { name: /Filter/i })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Preferences/i })
    ).not.toBeInTheDocument()
  })

  it('renders inline admin username filter input and triggers filter change and clear', async () => {
    const user = userEvent.setup()
    const onFilterChange = vi.fn()

    const filters: DashboardFilters = {
      preset: '7d',
      username: 'bob',
    }

    render(
      <DashboardToolbar
        currentFilters={filters}
        onFilterChange={onFilterChange}
        onResetFilters={vi.fn()}
        activeSection='models'
        visibleSections={['models', 'flow', 'users']}
        sectionMeta={SECTION_META}
        onSectionChange={vi.fn()}
        isAdmin
      />
    )

    const input = screen.getByPlaceholderText('Filter by username')
    expect(input).toBeDefined()
    expect((input as HTMLInputElement).value).toBe('bob')

    const clearButton = screen.getByRole('button', { name: 'Clear username' })
    await user.click(clearButton)
    expect(onFilterChange).toHaveBeenCalledWith(
      expect.not.objectContaining({
        username: expect.anything(),
      })
    )
  })
})
