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
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { OverviewDashboard } from '../overview-dashboard'

let client: QueryClient
let requestedUrls: string[] = []

beforeEach(() => {
  window.localStorage.clear()
  requestedUrls = []
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })

  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    requestedUrls.push(url)
    const base = url.split('?')[0]

    switch (base) {
      case '/api/token/':
        return {
          data: {
            success: true,
            data: {
              items: [{ id: 1, name: 'App key', key: 'masked', status: 1 }],
            },
          },
        }
      case '/api/status':
        return {
          data: {
            data: {
              api_info_enabled: false,
              announcements_enabled: false,
              faq_enabled: false,
              uptime_kuma_enabled: false,
            },
          },
        }
      case '/api/user/models':
        return { data: { success: true, data: ['gpt-4o-mini'] } }
      case '/api/data/self':
        return {
          data: {
            success: true,
            data: [
              {
                model_name: 'gpt-4o',
                created_at: 1000,
                count: 1,
                quota: 500000, // $1
                token_used: 100,
              },
            ],
          },
        }
      case '/api/data':
        return {
          data: {
            success: true,
            data: [
              {
                model_name: 'gpt-4o',
                created_at: 1000,
                count: 10,
                quota: 5000000, // $10
                token_used: 1000,
              },
            ],
          },
        }
      case '/api/log/self/stat':
        return {
          data: {
            success: true,
            data: {
              quota: 500000,
              rpm: 1,
              tpm: 100,
            },
          },
        }
      case '/api/log/stat':
        return {
          data: {
            success: true,
            data: {
              quota: 5000000,
              rpm: 10,
              tpm: 1000,
            },
          },
        }
      default:
        throw new Error(`Unexpected overview request: ${url}`)
    }
  })
})

afterEach(() => {
  cleanup()
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderOverview() {
  const router = createRouter({
    routeTree: createRootRoute({ component: OverviewDashboard }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

describe('overview scope toggle', () => {
  it('does not render scope tabs for regular users and queries self data', async () => {
    useAuthStore.getState().auth.setUser({
      id: 2,
      username: 'normal-user',
      role: ROLE.USER,
      quota: 1000000,
      used_quota: 2000,
      request_count: 5,
    })

    await renderOverview()

    // Regular users do not see the All / Only Mine tabs
    expect(screen.queryByRole('tab', { name: 'All' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('tab', { name: 'Only Mine' })
    ).not.toBeInTheDocument()

    // Default card title is personal "Last 24h usage" (appears in both main card and side panel)
    await waitFor(() => {
      expect(
        screen.getAllByText('Last 24h usage').length
      ).toBeGreaterThanOrEqual(1)
    })

    // Requests should go to /self endpoints
    await waitFor(() => {
      expect(requestedUrls.some((u) => u.startsWith('/api/data/self'))).toBe(
        true
      )
      expect(
        requestedUrls.some((u) => u.startsWith('/api/log/self/stat'))
      ).toBe(true)
      expect(
        requestedUrls.some(
          (u) => u === '/api/data' || u.startsWith('/api/data?')
        )
      ).toBe(false)
      expect(
        requestedUrls.some(
          (u) => u === '/api/log/stat' || u.startsWith('/api/log/stat?')
        )
      ).toBe(false)
    })
  })

  it('renders scope tabs for admins and defaults to all platform view', async () => {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin-user',
      role: ROLE.ADMIN,
      quota: 2000000,
      used_quota: 5000,
      request_count: 10,
    })

    await renderOverview()

    // Scope toggle tabs exist and 'All' is selected by default
    const allTab = await screen.findByRole('tab', { name: 'All' })
    const selfTab = screen.getByRole('tab', { name: 'Only Mine' })
    expect(allTab).toHaveAttribute('data-active', '')
    expect(selfTab).not.toHaveAttribute('data-active')

    // Shows platform 24h usage title and description
    expect(
      await screen.findByText('Last 24h platform usage')
    ).toBeInTheDocument()

    // Right panel displays admin's own wallet balance and personal usage
    expect(screen.getByText('My balance')).toBeInTheDocument()
    expect(screen.getByText('My 24h usage')).toBeInTheDocument()

    // Requests should include /api/data and /api/log/stat for platform figures
    await waitFor(() => {
      expect(
        requestedUrls.some(
          (u) => u.startsWith('/api/data') && !u.startsWith('/api/data/self')
        )
      ).toBe(true)
      expect(requestedUrls.some((u) => u.startsWith('/api/log/stat'))).toBe(
        true
      )
    })
  })

  it('switches to self view when admin clicks Only Mine', async () => {
    const user = userEvent.setup()
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'admin-user',
      role: ROLE.ADMIN,
      quota: 2000000,
      used_quota: 5000,
      request_count: 10,
    })

    await renderOverview()

    const selfTab = await screen.findByRole('tab', { name: 'Only Mine' })
    await user.click(selfTab)

    expect(selfTab).toHaveAttribute('data-active', '')

    // Title changes back to personal "Last 24h usage" (appears in both main card and side panel)
    await waitFor(() => {
      expect(
        screen.getAllByText('Last 24h usage').length
      ).toBeGreaterThanOrEqual(1)
    })
    expect(screen.getByText('Credit remaining')).toBeInTheDocument()

    // Requests should switch to /self
    await waitFor(() => {
      expect(requestedUrls.some((u) => u.startsWith('/api/data/self'))).toBe(
        true
      )
      expect(
        requestedUrls.some((u) => u.startsWith('/api/log/self/stat'))
      ).toBe(true)
    })
  })
})
