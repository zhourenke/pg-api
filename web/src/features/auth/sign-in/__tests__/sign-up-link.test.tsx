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
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { SystemStatus } from '@/features/auth/types'
import { createAppQueryClient } from '@/lib/query-client'

import { SignIn } from '../index'

let currentStatus: Partial<SystemStatus> = {}

vi.mock('@/hooks/use-status', () => ({
  useStatus: () => ({ status: currentStatus, loading: false, error: null }),
}))

vi.mock('../components/user-auth-form', () => ({
  UserAuthForm: () => null,
}))

// 登录页的「还没有账号？注册」只有在确实存在可用的注册方式时才出现。
async function renderSignIn() {
  const root = createRootRoute()
  const group = createRoute({ getParentRoute: () => root, id: '/(auth)' })
  const signIn = createRoute({
    getParentRoute: () => group,
    path: 'sign-in',
    component: () => <SignIn />,
  })
  const router = createRouter({
    routeTree: root.addChildren([group.addChildren([signIn])]),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  })
  await router.load()
  const client = createAppQueryClient()
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('heading', { name: 'Sign in' })
}

afterEach(() => {
  cleanup()
})

const cases: Array<{
  name: string
  status: Partial<SystemStatus>
  visible: boolean
}> = [
  {
    name: 'registration is turned off entirely',
    status: { register_enabled: false, password_register_enabled: true },
    visible: false,
  },
  {
    name: 'both password and oauth registration are turned off',
    status: {
      register_enabled: true,
      password_register_enabled: false,
      oauth_register_enabled: false,
    },
    visible: false,
  },
  {
    name: 'self use mode is on',
    status: {
      self_use_mode_enabled: true,
      register_enabled: true,
      password_register_enabled: true,
    },
    visible: false,
  },
  {
    name: 'password registration is available',
    status: { register_enabled: true, password_register_enabled: true },
    visible: true,
  },
  {
    name: 'oauth registration is available',
    status: {
      register_enabled: true,
      password_register_enabled: false,
      oauth_register_enabled: true,
    },
    visible: true,
  },
]

it.each(cases)(
  'shows the sign up link only when registration is available: $name',
  async ({ status, visible }) => {
    currentStatus = status
    await renderSignIn()
    if (visible) {
      expect(await screen.findByRole('link', { name: 'Sign up' })).toHaveAttribute(
        'href',
        '/sign-up'
      )
    } else {
      expect(screen.queryByRole('link', { name: 'Sign up' })).toBeNull()
    }
  }
)
