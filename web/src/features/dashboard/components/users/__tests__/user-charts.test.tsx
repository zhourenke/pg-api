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
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { UserChartsFilters } from '@/features/dashboard/types'

import { UserCharts } from '../user-charts'

let mountCount = 0
let unmountCount = 0

vi.mock('@visactor/react-vchart', () => ({
  VChart: () => {
    useEffect(() => {
      mountCount++
      return () => {
        unmountCount++
      }
    }, [])
    return <div data-testid='vchart-user-mock' />
  },
}))

vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

vi.mock('@/features/dashboard/api', () => ({
  getUserQuotaDataByUsers: vi.fn(async () => ({
    success: true,
    data: [
      {
        user_id: 1,
        username: 'alice',
        count: 10,
        quota: 50000,
        token_used: 1000,
      },
      {
        user_id: 2,
        username: 'bob',
        count: 5,
        quota: 20000,
        token_used: 500,
      },
    ],
  })),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 60_000,
      },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('UserCharts preset and granularity updates', () => {
  beforeEach(() => {
    mountCount = 0
    unmountCount = 0
  })

  afterEach(() => {
    cleanup()
  })

  it('triggers onFiltersChange on limit change and remounts charts on window update', async () => {
    const user = userEvent.setup()
    const onFiltersChange = vi.fn()
    const filters: UserChartsFilters = {
      preset: 'today',
      timeGranularity: 'hour',
      topUserLimit: 10,
    }

    const Wrapper = createWrapper()
    const { rerender } = render(
      <Wrapper>
        <UserCharts filters={filters} onFiltersChange={onFiltersChange} />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getByTestId('vchart-user-mock')).toBeInTheDocument()
    })
    const initialMounts = mountCount
    expect(initialMounts).toBeGreaterThanOrEqual(1)

    // Click 'Top 20' tab
    const btn20 = screen.getByRole('tab', { name: /20/ })
    await user.click(btn20)

    expect(onFiltersChange).toHaveBeenCalledWith(
      expect.objectContaining({ topUserLimit: 20 })
    )

    // Re-render with updated preset from DashboardToolbar
    rerender(
      <Wrapper>
        <UserCharts
          filters={{ ...filters, preset: '7d' }}
          onFiltersChange={onFiltersChange}
        />
      </Wrapper>
    )

    // Chart must remount with the updated time window bounds in its key
    await waitFor(() => {
      expect(mountCount).toBeGreaterThan(initialMounts)
      expect(unmountCount).toBeGreaterThanOrEqual(1)
    })
  })

  it('filters users using fuzzy username matching', async () => {
    const filters: UserChartsFilters = {
      preset: 'today',
      timeGranularity: 'hour',
      topUserLimit: 10,
      username: 'lic',
    }

    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <UserCharts filters={filters} onFiltersChange={vi.fn()} />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument()
    })
    expect(screen.queryByText('bob')).not.toBeInTheDocument()
  })
})
