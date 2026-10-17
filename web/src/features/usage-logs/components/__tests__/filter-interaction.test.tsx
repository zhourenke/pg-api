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
import { getCoreRowModel, useReactTable } from '@tanstack/react-table'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { UsageLogsProvider } from '../usage-logs-provider'

function FilterFixture() {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <UsageLogsProvider>
      <CommonLogsFilterBar table={table} />
    </UsageLogsProvider>
  )
}

async function renderFilter(initialSearch = '/usage-logs/common') {
  vi.spyOn(api, 'get').mockImplementation(async (url) => ({
    data: {
      success: true,
      data: url === '/api/user/self/groups' ? {} : { quota: 0, rpm: 0, tpm: 0 },
    },
  }))
  const root = createRootRoute()
  const auth = createRoute({ getParentRoute: () => root, id: '_authenticated' })
  const logs = createRoute({
    getParentRoute: () => auth,
    path: '/usage-logs/$section',
    component: FilterFixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({
      initialEntries: [initialSearch],
    }),
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const invalidateQueriesSpy = vi.spyOn(queryClient, 'invalidateQueries')

  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByPlaceholderText('Model Name')
  return { router, queryClient, invalidateQueriesSpy }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('does not trigger search automatically on typing in model filter', async () => {
  const { router } = await renderFilter()
  const input = screen.getByPlaceholderText('Model Name')

  fireEvent.change(input, { target: { value: 'gem' } })
  expect(input).toHaveValue('gem')
  expect(router.state.location.search).not.toHaveProperty('model')
})

it('triggers search and updates searchParams when pressing Enter in filter input', async () => {
  const { router, invalidateQueriesSpy } = await renderFilter()
  const input = screen.getByPlaceholderText('Model Name')

  fireEvent.change(input, { target: { value: 'gemini' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      page: 1,
      model: 'gemini',
    })
  )
  expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['logs'] })
  expect(invalidateQueriesSpy).toHaveBeenCalledWith({
    queryKey: ['usage-logs-stats'],
  })
})

it('commits draft filter and refreshes when clicking Refresh button', async () => {
  const { router, invalidateQueriesSpy } = await renderFilter()
  const user = userEvent.setup()
  const input = screen.getByPlaceholderText('Model Name')

  fireEvent.change(input, { target: { value: 'claude' } })
  const refreshButton = screen.getByRole('button', { name: 'Refresh' })
  await user.click(refreshButton)

  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      page: 1,
      model: 'claude',
    })
  )
  expect(invalidateQueriesSpy).toHaveBeenCalledWith({ queryKey: ['logs'] })
  expect(invalidateQueriesSpy).toHaveBeenCalledWith({
    queryKey: ['usage-logs-stats'],
  })
})

it('preserves default 24h preset and stays as 24 Hours when clicking Refresh button', async () => {
  const { router } = await renderFilter()
  const user = userEvent.setup()

  expect(screen.getByRole('button', { name: '24 Hours' })).toBeVisible()

  const refreshButton = screen.getByRole('button', { name: 'Refresh' })
  await user.click(refreshButton)

  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      preset: '24h',
    })
  })
  expect(screen.getByRole('button', { name: '24 Hours' })).toBeVisible()
})

it('preserves default 24h preset when submitting search with Enter in input', async () => {
  const { router } = await renderFilter()
  const input = screen.getByPlaceholderText('Model Name')

  fireEvent.change(input, { target: { value: 'gpt-4o' } })
  fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      model: 'gpt-4o',
      preset: '24h',
    })
  })
  expect(screen.getByRole('button', { name: '24 Hours' })).toBeVisible()
})

it('preserves chosen preset and advances timestamp on subsequent refresh', async () => {
  const { router } = await renderFilter('/usage-logs/common?preset=7d')
  const user = userEvent.setup()

  expect(screen.getByRole('button', { name: '7 Days' })).toBeVisible()

  const refreshButton = screen.getByRole('button', { name: 'Refresh' })
  await user.click(refreshButton)

  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      preset: '7d',
    })
  })
  expect(screen.getByRole('button', { name: '7 Days' })).toBeVisible()
})

it('preserves custom time range on refresh without reverting to preset', async () => {
  // A hand-picked timestamp range without preset
  const customStart = 1700000000000
  const customEnd = 1700086400000
  const { router } = await renderFilter(
    `/usage-logs/common?startTime=${customStart}&endTime=${customEnd}`
  )
  const user = userEvent.setup()

  const refreshButton = screen.getByRole('button', { name: 'Refresh' })
  await user.click(refreshButton)

  await waitFor(() => {
    expect(router.state.location.search).toMatchObject({
      startTime: customStart,
      endTime: customEnd,
    })
    expect(router.state.location.search).not.toHaveProperty('preset')
  })
})
