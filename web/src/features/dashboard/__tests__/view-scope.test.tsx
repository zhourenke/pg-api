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
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { Dashboard } from '../index'

vi.mock('@visactor/react-vchart', () => ({
  VChart: () => <div data-testid='vchart-mock' />,
}))
vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

let requestedUrls: string[] = []
let client: QueryClient

beforeEach(() => {
  window.localStorage.clear()
  requestedUrls = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    requestedUrls.push(url)
    if (url.startsWith('/api/status')) {
      return { data: { success: true, data: {} } }
    }
    if (url.startsWith('/api/data')) {
      return {
        data: {
          success: true,
          data: [
            {
              model_name: 'gpt-4o',
              created_at: 1000,
              count: 10,
              quota: 5000000,
              token_used: 1000,
            },
          ],
        },
      }
    }
    throw new Error(`Unexpected dashboard request: ${url}`)
  })
})

afterEach(() => {
  client.clear()
  useAuthStore.setState(useAuthStore.getInitialState(), true)
  window.localStorage.clear()
})

async function renderDashboard(path = '/dashboard/models') {
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const dashboard = createRoute({
    getParentRoute: () => auth,
    path: '/dashboard/$section',
    component: Dashboard,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([dashboard])]),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  await router.load()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  return router
}

function setUser(role: number) {
  useAuthStore.getState().auth.setUser({
    id: 1,
    username: 'admin-user',
    role,
    quota: 2000000,
    used_quota: 5000,
    request_count: 10,
  })
}

describe('dashboard view scope switch', () => {
  it('offers the switch to admins and starts on the platform view', async () => {
    setUser(ROLE.ADMIN)

    await renderDashboard()

    const allTab = await screen.findByRole('tab', { name: 'All' })
    expect(allTab).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Only Mine' })).toBeDefined()

    await waitFor(() =>
      expect(
        requestedUrls.some(
          (url) =>
            url.startsWith('/api/data') && !url.startsWith('/api/data/self')
        )
      ).toBe(true)
    )
  })

  it('queries the self endpoint after switching to only mine', async () => {
    const user = userEvent.setup()
    setUser(ROLE.ADMIN)

    await renderDashboard()

    await waitFor(() =>
      expect(
        requestedUrls.some(
          (url) =>
            url.startsWith('/api/data') && !url.startsWith('/api/data/self')
        )
      ).toBe(true)
    )
    expect(requestedUrls.some((url) => url.startsWith('/api/data/self'))).toBe(
      false
    )

    await user.click(await screen.findByRole('tab', { name: 'Only Mine' }))

    await waitFor(() =>
      expect(
        requestedUrls.some((url) => url.startsWith('/api/data/self'))
      ).toBe(true)
    )
    expect(screen.getByRole('tab', { name: 'Only Mine' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
  })

  it('hides the admin-only user section while only mine is active', async () => {
    const user = userEvent.setup()
    setUser(ROLE.ADMIN)

    await renderDashboard()

    expect(
      await screen.findByRole('tab', { name: 'User Analytics' })
    ).toBeDefined()

    await user.click(screen.getByRole('tab', { name: 'Only Mine' }))

    await waitFor(() =>
      expect(
        screen.queryByRole('tab', { name: 'User Analytics' })
      ).not.toBeInTheDocument()
    )
  })

  it('does not render the switch for regular users', async () => {
    setUser(ROLE.USER)

    await renderDashboard()

    await waitFor(() =>
      expect(
        requestedUrls.some((url) => url.startsWith('/api/data/self'))
      ).toBe(true)
    )
    expect(screen.queryByRole('tablist', { name: 'View scope' })).toBeNull()
    expect(screen.queryByRole('tab', { name: 'Only Mine' })).toBeNull()
  })
})
