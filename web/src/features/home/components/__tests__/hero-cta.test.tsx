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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { HeroButtons } from '../hero-buttons'

// 未登录访客的主按钮必须去登录页：注册入口是独立链接，不能替用户选注册。
async function renderHeroButtons(isAuthenticated: boolean) {
  const root = createRootRoute()
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <HeroButtons isAuthenticated={isAuthenticated} />,
  })
  const router = createRouter({
    routeTree: root.addChildren([home]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
}

afterEach(() => cleanup())

it('sends a signed out visitor to the sign in page from the hero call to action', async () => {
  await renderHeroButtons(false)
  expect(
    await screen.findByRole('button', { name: /Get Started/ })
  ).toHaveAttribute('href', '/sign-in')
  expect(screen.getByRole('button', { name: /Sign In/ })).toHaveAttribute(
    'href',
    '/sign-in'
  )
})

it('keeps pointing a signed in visitor at the dashboard', async () => {
  await renderHeroButtons(true)
  expect(
    await screen.findByRole('button', { name: /Go to Dashboard/ })
  ).toHaveAttribute('href', '/dashboard')
  expect(screen.queryByRole('button', { name: /Get Started/ })).toBeNull()
})
