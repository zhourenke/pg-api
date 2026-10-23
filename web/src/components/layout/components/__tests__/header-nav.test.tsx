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
import { afterEach, expect, it } from 'vitest'

import { SidebarProvider } from '@/components/ui/sidebar'
import { DirectionProvider } from '@/context/direction-provider'
import { LayoutProvider } from '@/context/layout-provider'
import { SearchProvider } from '@/context/search-provider'
import { ThemeProvider } from '@/context/theme-provider'
import { useAuthStore } from '@/stores/auth-store'

import { AppHeader } from '../app-header'

async function renderHeader() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    system_name: 'PG API',
    HeaderNavModules: JSON.stringify({
      home: true,
      console: true,
      pricing: { enabled: true, requireAuth: false },
      rankings: { enabled: true, requireAuth: false },
      docs: true,
      about: true,
    }),
    docs_link: 'https://docs.example.com',
  })

  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => (
      <QueryClientProvider client={client}>
        <DirectionProvider>
          <ThemeProvider>
            <LayoutProvider>
              <SearchProvider>
                <SidebarProvider>
                  <AppHeader />
                </SidebarProvider>
              </SearchProvider>
            </LayoutProvider>
          </ThemeProvider>
        </DirectionProvider>
      </QueryClientProvider>
    ),
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  render(<RouterProvider router={router} />)
}

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})

it('keeps the site navigation reachable below the desktop breakpoint', async () => {
  // The header used to wrap TopNav in `hidden lg:block`, which also hid the
  // dropdown TopNav renders below `lg`; model square and rankings were then
  // unreachable from the console on phones and tablets.
  await renderHeader()

  const trigger = await screen.findByRole('button', { name: 'Site navigation' })
  expect(trigger).toBeInTheDocument()

  await userEvent.click(trigger)

  expect(
    await screen.findByRole('menuitem', { name: 'Model Square' })
  ).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Rankings' })).toBeInTheDocument()
})

it('gives the site navigation trigger its own glyph, not a second hamburger', async () => {
  await renderHeader()

  const trigger = await screen.findByRole('button', { name: 'Site navigation' })
  const sidebarToggle = screen.getByRole('button', { name: 'Toggle Sidebar' })

  // The two controls sit in the same row; sharing a glyph left users unable to
  // tell which one opens the sidebar and which one opens site navigation.
  const navGlyph = trigger.querySelector('svg')?.outerHTML
  const sidebarGlyph = sidebarToggle.querySelector('svg')?.outerHTML
  expect(navGlyph).toBeTruthy()
  expect(navGlyph).not.toBe(sidebarGlyph)
})
