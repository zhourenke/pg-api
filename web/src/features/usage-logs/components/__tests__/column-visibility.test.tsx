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
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { UsageLogs } from '../../index'

describe('UsageLogs column visibility and toggle behavior', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    i18next.addResourceBundle(
      'zhCN',
      'translation',
      zhCN.translation,
      true,
      true
    )

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
                channel_name: 'OpenAI Channel',
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
    cleanup()
    vi.restoreAllMocks()
    i18next.removeResourceBundle('zhCN', 'translation')
  })

  function renderUsageLogs() {
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

    return render(
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    )
  }

  it('includes all 10 columns in the View menu without any missing items', async () => {
    const user = userEvent.setup()
    renderUsageLogs()

    const viewButton = await screen.findByRole('button', { name: '查看' })
    await user.click(viewButton)

    // Expected items in Chinese order
    const expectedLabels = [
      '时间',
      '渠道',
      '用户',
      '令牌',
      '模型',
      '流',
      'Tokens',
      '费用',
      '耗时',
      '日志详情',
    ]

    const items = screen.getAllByRole('menuitemcheckbox')
    const actualLabels = items.map((el) => el.textContent?.trim())
    expect(actualLabels).toEqual(expectedLabels)

    for (const item of items) {
      expect(item).toHaveAttribute('aria-checked', 'true')
    }
  })

  it('toggles column visibility and checkbox state back and forth on repeated clicks', async () => {
    const user = userEvent.setup()
    renderUsageLogs()

    const viewButton = await screen.findByRole('button', { name: '查看' })
    await user.click(viewButton)

    const modelCheckbox = await screen.findByRole('menuitemcheckbox', {
      name: '模型',
    })
    expect(modelCheckbox).toHaveAttribute('aria-checked', 'true')

    // 1st click: hides column, unchecks box
    await user.click(modelCheckbox)
    expect(modelCheckbox).toHaveAttribute('aria-checked', 'false')

    // 2nd click: shows column, re-checks box
    await user.click(modelCheckbox)
    expect(modelCheckbox).toHaveAttribute('aria-checked', 'true')

    // 3rd click: hides column again, unchecks box
    await user.click(modelCheckbox)
    expect(modelCheckbox).toHaveAttribute('aria-checked', 'false')

    // 4th click: shows column again, re-checks box
    await user.click(modelCheckbox)
    expect(modelCheckbox).toHaveAttribute('aria-checked', 'true')
  })
})
