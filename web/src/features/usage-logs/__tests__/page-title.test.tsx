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
import { act, cleanup, render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { afterEach, expect, it, vi } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'

import { UsageLogs } from '..'
import { getUsageLogsSectionNavItems } from '../section-registry'

async function renderPage() {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url.startsWith('/api/log')) {
      return { data: { success: true, data: { items: [], total: 0 } } }
    }
    if (url === '/api/user/self/groups' || url === '/api/group/') {
      return { data: { success: true, data: {} } }
    }
    return { data: { success: true, data: { quota: 0, rpm: 0, tpm: 0 } } }
  })
  await act(async () => {
    i18n.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
    await i18n.changeLanguage('zhCN')
  })

  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: UsageLogs,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({ initialEntries: ['/usage-logs/common'] }),
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: '使用日志' })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  useAuthStore.getState().auth.setUser(null)
})

it('calls the page 使用日志 in its heading and in its section nav item', async () => {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  await renderPage()

  // 标题与段落导航共用同一个词条，两者一起改名才不会自相矛盾。
  expect(screen.getByRole('heading', { name: '使用日志' })).toBeVisible()
  expect(screen.queryByText('通用日志')).not.toBeInTheDocument()
  expect(
    getUsageLogsSectionNavItems(i18n.t.bind(i18n)).map((item) => item.title)
  ).toEqual(['使用日志'])
})
