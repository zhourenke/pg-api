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
let lastSpec: Record<string, unknown> = {}

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { spec: Record<string, unknown> }) => {
    lastSpec = props.spec
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
    const btn20 = screen.getAllByRole('tab', { name: /20/ })[0]
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

  it('puts the area/bar switch left of the limit tabs and draws bars once chosen', async () => {
    const user = userEvent.setup()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <UserCharts
          filters={{
            preset: 'today',
            timeGranularity: 'hour',
            topUserLimit: 10,
          }}
          onFiltersChange={vi.fn()}
        />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getAllByTestId('vchart-user-mock').length).toBeGreaterThan(
        0
      )
    })

    expect(
      screen
        .getAllByRole('tab')
        .map((tab) => tab.textContent)
        .slice(0, 6)
    ).toEqual([
      'Area Chart',
      'Bar Chart',
      'Top 5',
      'Top 10',
      'Top 20',
      'Top 50',
    ])
    expect(lastSpec.type).toBe('area')

    await user.click(screen.getByRole('tab', { name: 'Bar Chart' }))
    await waitFor(() => {
      expect(lastSpec.type).toBe('bar')
    })
  })

  it('lets a tap open the tooltip instead of only a hover', async () => {
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <UserCharts
          filters={{
            preset: 'today',
            timeGranularity: 'hour',
            topUserLimit: 10,
          }}
          onFiltersChange={vi.fn()}
        />
      </Wrapper>
    )

    await waitFor(() => {
      expect(lastSpec.type).toBe('area')
    })
    // A tap never emits pointermove, which is the only hover entry point in
    // `desktop-browser` mode, so the tap trigger is what makes this readable on
    // a phone.
    expect((lastSpec.tooltip as { trigger?: string[] }).trigger).toEqual([
      'hover',
      'click',
    ])
    // The grey column follows the tooltip, so a tap moves it too.
    expect(lastSpec.crosshair).toEqual({ followTooltip: true })
  })

  it('orders the breakdown table by the field and direction picked in the toolbar control', async () => {
    const user = userEvent.setup()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <UserCharts
          filters={{
            preset: 'today',
            timeGranularity: 'hour',
            topUserLimit: 10,
          }}
          onFiltersChange={vi.fn()}
        />
      </Wrapper>
    )

    const firstBodyRowName = () =>
      document.querySelector('tbody tr td')?.textContent ?? ''

    await waitFor(() => {
      expect(firstBodyRowName()).toContain('alice')
    })

    await user.click(screen.getByRole('button', { name: 'Quota' }))
    await user.click(await screen.findByRole('menuitem', { name: 'Requests' }))
    // The control starts descending, so flipping the arrow sorts ascending.
    await user.click(screen.getByRole('button', { name: 'Sort descending' }))

    await waitFor(() => {
      // bob has 5 requests against alice's 10, so ascending puts bob first.
      expect(firstBodyRowName()).toContain('bob')
    })
  })

  it('keeps the column headers plain and offers the fit and view controls', async () => {
    const user = userEvent.setup()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <UserCharts
          filters={{
            preset: 'today',
            timeGranularity: 'hour',
            topUserLimit: 10,
          }}
          onFiltersChange={vi.fn()}
        />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument()
    })

    for (const name of ['User', 'Quota', 'Requests', 'Token Count']) {
      expect(
        screen.getByRole('columnheader', { name }).querySelector('button')
      ).toBeNull()
    }

    expect(
      screen.getByRole('button', { name: 'Fit column widths' })
    ).toBeVisible()

    await user.click(screen.getByRole('button', { name: 'View' }))
    expect(
      await screen.findByRole('menuitemcheckbox', { name: 'Quota' })
    ).toBeVisible()
  })
})
