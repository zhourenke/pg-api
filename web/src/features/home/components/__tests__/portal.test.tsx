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

import { useAuthStore } from '@/stores/auth-store'

import { Portal } from '../portal'

const DEFAULT_MODULES = {
  home: true,
  console: true,
  pricing: { enabled: true, requireAuth: false },
  rankings: { enabled: true, requireAuth: false },
  docs: true,
  about: true,
}

type RenderOptions = {
  modules?: Record<string, unknown>
  docsLink?: string
  signedIn?: boolean
}

async function renderPortal(options: RenderOptions = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], {
    system_name: 'PG API',
    HeaderNavModules: JSON.stringify(options.modules ?? DEFAULT_MODULES),
    docs_link: options.docsLink,
  })

  if (options.signedIn) {
    useAuthStore.getState().auth.setUser({
      id: 1,
      username: 'alice',
      role: 1,
    })
  }

  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <Portal />,
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()

  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

afterEach(() => {
  cleanup()
  useAuthStore.getState().auth.reset()
})

it('lists every enabled cross-section entry but never the current page or the console', async () => {
  await renderPortal({ docsLink: 'https://docs.example.com' })

  const nav = await screen.findByRole('navigation', { name: 'Site navigation' })
  expect(nav).toBeInTheDocument()
  expect(screen.getByText('Model Square')).toBeInTheDocument()
  expect(screen.getByText('Rankings')).toBeInTheDocument()
  expect(screen.getByText('Docs')).toBeInTheDocument()
  expect(screen.getByText('About')).toBeInTheDocument()
  // Home is the current page and Console is promoted to the primary button, so
  // neither may appear a second time as an entry.
  expect(screen.queryByText('Home')).toBeNull()
  expect(nav).not.toHaveTextContent('Console')
})

it('drops the entries whose modules the administrator disabled', async () => {
  await renderPortal({
    modules: {
      home: true,
      console: true,
      pricing: { enabled: true, requireAuth: false },
      rankings: { enabled: true, requireAuth: false },
      docs: false,
      about: false,
    },
    docsLink: 'https://docs.example.com',
  })

  expect(await screen.findByText('Model Square')).toBeInTheDocument()
  expect(screen.getByText('Rankings')).toBeInTheDocument()
  expect(screen.queryByText('Docs')).toBeNull()
  expect(screen.queryByText('About')).toBeNull()
})

it('hides the docs entry when no documentation link is configured', async () => {
  // There is no local /docs route, so falling back to it would render a dead
  // link; the entry has to disappear instead.
  await renderPortal({ docsLink: undefined })

  expect(await screen.findByText('Model Square')).toBeInTheDocument()
  expect(screen.queryByText('Docs')).toBeNull()
})

it('removes the primary button when the console module is disabled', async () => {
  await renderPortal({
    modules: { ...DEFAULT_MODULES, console: false },
    docsLink: 'https://docs.example.com',
  })

  expect(await screen.findByText('Model Square')).toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: /Go to Console|Sign in/ })
  ).toBeNull()
})

it('sends a signed in visitor to the console and a visitor to sign in', async () => {
  await renderPortal({ signedIn: true })
  expect(
    await screen.findByRole('button', { name: /Go to Console/ })
  ).toHaveAttribute('href', '/dashboard')

  cleanup()
  useAuthStore.getState().auth.reset()

  await renderPortal({ signedIn: false })
  expect(
    await screen.findByRole('button', { name: /Sign in/ })
  ).toHaveAttribute('href', '/sign-in')
})

it('explains the sign-in requirement instead of bouncing a visitor silently', async () => {
  await renderPortal({
    modules: {
      ...DEFAULT_MODULES,
      pricing: { enabled: true, requireAuth: true },
    },
  })

  const entry = await screen.findByRole('button', { name: /Model Square/ })
  await userEvent.click(entry)

  expect(await screen.findByText('Sign in required')).toBeInTheDocument()
  expect(
    screen.getByText(/Please sign in to view Model Square\./)
  ).toBeInTheDocument()
})
