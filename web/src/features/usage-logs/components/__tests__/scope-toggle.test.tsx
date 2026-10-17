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
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { UsageLogs } from '../../index'

const CHARACTER_WIDTH = 8

function stubScrollingWidth() {
  return vi
    .spyOn(HTMLElement.prototype, 'scrollWidth', 'get')
    .mockImplementation(function (this: HTMLElement) {
      const insideActiveContainer = [...this.querySelectorAll('*')].some(
        (node) => {
          const containerType = window.getComputedStyle(node).containerType

          return containerType !== '' && containerType !== 'normal'
        }
      )

      if (insideActiveContainer) {
        return 0
      }

      return (this.textContent ?? '').trim().length * CHARACTER_WIDTH
    })
}

describe('UsageLogs scope switch', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    stubScrollingWidth()
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    })

    useAuthStore.setState({
      auth: {
        ...useAuthStore.getState().auth,
        user: {
          id: 1,
          username: 'admin',
          role: ROLE.ADMIN,
          status: 1,
        },
      },
    })

    vi.spyOn(api, 'get').mockImplementation(async (url) => {
      if (url === '/api/user/self/groups' || url === '/api/group/') {
        return { data: { success: true, data: [] } }
      }
      if (url === '/api/log/self/stat' || url === '/api/log/stat') {
        return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
      }
      if (String(url).startsWith('/api/log/self')) {
        // User logs have NO channel_name (stripped by formatUserLogs)
        return {
          data: {
            success: true,
            data: {
              items: [
                {
                  id: 1,
                  created_at: 1711700000,
                  type: 2,
                  channel: 42,
                  channel_name: '',
                  username: '',
                  user_id: 1,
                  token_name: 'default',
                  model_name: 'gpt-4o',
                  is_stream: true,
                  prompt_tokens: 100,
                  completion_tokens: 50,
                  quota: 300,
                  use_time: 1200,
                  other: '',
                },
              ],
              total: 1,
            },
          },
        }
      }
      // Admin logs
      return {
        data: {
          success: true,
          data: {
            items: [
              {
                id: 1,
                created_at: 1711700000,
                type: 2,
                channel: 42,
                channel_name: 'OpenAI Long Name Channel Test 12345',
                username: 'admin',
                user_id: 1,
                token_name: 'default',
                model_name: 'gpt-4o',
                is_stream: true,
                prompt_tokens: 100,
                completion_tokens: 50,
                quota: 300,
                use_time: 1200,
                other: '',
              },
            ],
            total: 1,
          },
        },
      }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  it('preserves channel column when switching from all to self and back to all', async () => {
    const root = createRootRoute()
    const auth = createRoute({
      getParentRoute: () => root,
      id: '_authenticated',
    })
    const logs = createRoute({
      getParentRoute: () => auth,
      path: '/usage-logs/$section',
      component: UsageLogs,
      validateSearch: (search: Record<string, unknown>) => search,
    })
    const router = createRouter({
      routeTree: root.addChildren([auth.addChildren([logs])]),
      history: createMemoryHistory({
        initialEntries: ['/usage-logs/common'],
      }),
    })

    render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )

    // Wait for the table to render with data
    await screen.findByText('OpenAI Long Name Channel Test 12345')

    const getColWidthsById = () => {
      const cols = [...screen.getByRole('table').querySelectorAll('col')]
      const ths = [...screen.getByRole('table').querySelectorAll('th')]
      return ths.map((th, i) => ({
        id: th.getAttribute('data-column-id'),
        width: cols[i]?.style.width,
      }))
    }

    const initialWidths = getColWidthsById()
    const initialChannelCol = initialWidths.find((c) => c.id === 'channel')
    expect(initialChannelCol).toBeDefined()
    expect(initialChannelCol?.width).toBe('320px')

    // Click "Only Mine"
    const onlyMineTab = screen.getByRole('tab', { name: 'Only Mine' })
    fireEvent.click(onlyMineTab)

    // Wait for data in "Only Mine"
    await screen.findByText('gpt-4o')

    const onlyMineWidths = getColWidthsById()
    expect(onlyMineWidths.some((c) => c.id === 'channel')).toBe(false)

    // Click "All"
    const allTab = screen.getByRole('tab', { name: 'All' })
    fireEvent.click(allTab)

    await screen.findByText('OpenAI Long Name Channel Test 12345')

    const backWidths = getColWidthsById()
    const backChannelCol = backWidths.find((c) => c.id === 'channel')
    expect(backChannelCol).toBeDefined()
    // Channel column should retain or re-measure its designed/content width and not collapse
    expect(backChannelCol?.width).toBe('320px')
  })
})
