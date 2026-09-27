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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { GeneralError } from '../general-error'

type RenderErrorOptions = {
  minimal?: boolean
  error?: unknown
  initialEntries?: string[]
}

async function renderError(options: RenderErrorOptions = {}) {
  const root = createRootRoute()
  const boom = createRoute({
    getParentRoute: () => root,
    path: '/boom',
    component: () => (
      <GeneralError minimal={options.minimal} error={options.error} />
    ),
  })
  const home = createRoute({
    getParentRoute: () => root,
    path: '/',
    component: () => <p>home</p>,
  })
  const router = createRouter({
    routeTree: root.addChildren([boom, home]),
    history: createMemoryHistory({
      initialEntries: options.initialEntries ?? ['/boom'],
    }),
  })
  await router.load()
  render(<RouterProvider router={router} />)
  return router
}

describe('GeneralError', () => {
  it('shows the HTTP status with the rate-limit copy and the in-app actions', async () => {
    await renderError({ error: { response: { status: 429 } } })

    expect(screen.getByText('429')).toBeInTheDocument()
    expect(screen.getByText('Too many requests')).toBeInTheDocument()
    expect(
      screen.getByText(/Please wait a moment before trying again\./)
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go Back' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Back to Home' })
    ).toBeInTheDocument()
  })

  it('falls back to 500 with the generic copy when the error carries no status', async () => {
    await renderError({ error: new Error('boom') })

    expect(screen.getByText('500')).toBeInTheDocument()
    expect(screen.getByText(/Oops! Something went wrong/)).toBeInTheDocument()
    expect(screen.getByText(/Please try again later\./)).toBeInTheDocument()
  })

  it('offers no external issue tracker entry point', async () => {
    await renderError({ error: { response: { status: 500 } } })

    expect(screen.queryByText('Report an issue')).not.toBeInTheDocument()
    expect(
      screen.queryByText(
        'If this keeps happening, please report it on GitHub Issues.'
      )
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(document.querySelector('a[href*="issues"]')).toBeNull()
  })

  it('returns to the previous page from the Go Back action', async () => {
    const user = userEvent.setup()
    const router = await renderError({ initialEntries: ['/', '/boom'] })

    await user.click(screen.getByRole('button', { name: 'Go Back' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('navigates home from the Back to Home action', async () => {
    const user = userEvent.setup()
    const router = await renderError({ error: { response: { status: 502 } } })

    await user.click(screen.getByRole('button', { name: 'Back to Home' }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/'))
  })

  it('hides the status number and the actions in minimal mode', async () => {
    await renderError({ minimal: true, error: { response: { status: 500 } } })

    expect(screen.queryByText('500')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText(/Oops! Something went wrong/)).toBeInTheDocument()
  })
})
