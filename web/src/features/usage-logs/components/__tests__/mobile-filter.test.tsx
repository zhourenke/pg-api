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
  render,
  screen,
  waitFor,
  within,
  fireEvent,
  cleanup,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18next from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'

import { CommonLogsFilterBar } from '../common-logs-filter-bar'
import { CompactDateTimeRangePicker } from '../compact-date-time-range-picker'
import { LogsFilterToolbar } from '../logs-filter-toolbar'
import { UsageLogsProvider } from '../usage-logs-provider'

const captureDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  'setPointerCapture'
)
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

function Fixture() {
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
async function renderMobileFilter() {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
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
    component: Fixture,
    validateSearch: (search: Record<string, unknown>) => search,
  })
  const router = createRouter({
    routeTree: root.addChildren([auth.addChildren([logs])]),
    history: createMemoryHistory({
      initialEntries: [
        '/usage-logs/common?page=3&type=%5B%222%22%5D&group=default',
      ],
    }),
  })
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  await screen.findByRole('button', { name: 'Filter' })
  return router
}
afterEach(async () => {
  if (captureDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      'setPointerCapture',
      captureDescriptor
    )
  } else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  await i18next.changeLanguage('zhCN')
})

it('applies the selected mobile date range directly and resets pagination while retaining filters', async () => {
  const router = await renderMobileFilter()
  const user = userEvent.setup()
  // The picker now opens on the trailing 24 hours, so the dated range comes
  // from the custom branch; the trigger is addressed as the picker's own
  // popover trigger rather than by the range label it currently shows.
  const trigger = document.querySelector<HTMLElement>(
    '[aria-haspopup="dialog"]'
  )
  if (!trigger) throw new Error('date range trigger not found')
  await user.click(trigger)
  await user.click(screen.getByRole('button', { name: 'Custom Time Range' }))
  fireEvent.change(screen.getByLabelText('Start Time'), {
    target: { value: '2026-09-07T09:30' },
  })
  fireEvent.change(screen.getByLabelText('End Time'), {
    target: { value: '2026-09-08T17:45' },
  })
  await user.click(screen.getByRole('button', { name: 'Confirm' }))
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      page: 1,
      group: 'default',
      type: ['2'],
      startTime: new Date('2026-09-07T09:30').getTime(),
      endTime: new Date('2026-09-08T17:45').getTime(),
    })
  )
})

it('applies a typed drawer filter after it settles, without a Search press', async () => {
  const router = await renderMobileFilter()
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  const dialog = await screen.findByRole('dialog', { name: 'Filter' })
  fireEvent.change(within(dialog).getByPlaceholderText('Model Name'), {
    target: { value: 'gemini-3.7-flash' },
  })
  expect(router.state.location.search).not.toHaveProperty('model')

  // Typed text waits for the shared 1000ms debounce, then applies on its own.
  await waitFor(
    () =>
      expect(router.state.location.search).toMatchObject({
        page: 1,
        model: 'gemini-3.7-flash',
      }),
    { timeout: 3000 }
  )
  // Applying does not close the drawer: only Refresh does.
  expect(screen.getByRole('dialog', { name: 'Filter' })).toBeVisible()
})

it('closes the drawer and re-pulls the logs when Refresh is pressed', async () => {
  const router = await renderMobileFilter()
  const user = userEvent.setup()
  const before = router.state.location.search
  await user.click(screen.getByRole('button', { name: 'Filter' }))
  const dialog = await screen.findByRole('dialog', { name: 'Filter' })
  await user.click(within(dialog).getByRole('button', { name: 'Refresh' }))

  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Filter' })
    ).not.toBeInTheDocument()
  )
  // Refreshing re-pulls the same filters instead of changing them.
  expect(router.state.location.search).toEqual(before)
})

it('keeps all quick actions visible without opening a menu', async () => {
  await renderMobileFilter()
  const user = userEvent.setup()
  for (const name of ['Hide', 'Filter', 'Refresh', 'View']) {
    expect(screen.getByRole('button', { name })).toBeVisible()
  }
  expect(screen.queryByRole('button', { name: 'More' })).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Hide' }))
  expect(screen.getByRole('button', { name: 'Show' })).toBeVisible()
  screen.getByRole('button', { name: 'Show' }).focus()
  for (const name of ['Filter', 'Refresh', 'View']) {
    await user.tab()
    expect(screen.getByRole('button', { name })).toHaveFocus()
  }
})

function LoadingFixture(props: { loading: boolean; onSearch: () => void }) {
  const table = useReactTable({
    data: [],
    columns: [],
    getCoreRowModel: getCoreRowModel(),
  })
  return (
    <LogsFilterToolbar
      table={table}
      compactMobile
      mobilePinnedFilters={<span>Date Range</span>}
      primaryFilters={null}
      hasActiveFilters={false}
      onReset={() => {}}
      onSearch={props.onSearch}
      searchLoading={props.loading}
    />
  )
}

it('keeps Refresh available while a fetch is in flight so it can re-pull', async () => {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: query === '(max-width: 640px)',
  }))
  const onSearch = vi.fn()
  const user = userEvent.setup()
  const view = render(<LoadingFixture loading onSearch={onSearch} />)
  const refresh = screen.getByRole('button', { name: 'Refresh' })
  expect(refresh).toBeVisible()
  await user.click(refresh)
  expect(onSearch).toHaveBeenCalledTimes(1)

  view.rerender(<LoadingFixture loading={false} onSearch={onSearch} />)
  expect(refresh).toBeEnabled()
  await user.click(refresh)
  expect(onSearch).toHaveBeenCalledTimes(2)
})

it('collapses only date and statistics while keeping the right-hand quick actions visible', async () => {
  await renderMobileFilter()
  const user = userEvent.setup()
  const trigger = document.querySelector<HTMLElement>(
    '[aria-haspopup="dialog"]'
  )
  expect(trigger).not.toBeNull()
  const date = trigger?.getAttribute('aria-label') ?? ''
  expect(await screen.findByText('Usage')).toBeVisible()
  await user.click(screen.getByRole('button', { name: 'Collapse' }))
  expect(screen.getByRole('button', { name: 'Expand' })).toHaveAttribute(
    'aria-expanded',
    'false'
  )
  expect(screen.queryByRole('button', { name: date })).not.toBeInTheDocument()
  expect(screen.queryByText('Usage')).not.toBeInTheDocument()
  const actions = screen.getByRole('group', { name: 'Actions' })
  for (const name of ['Hide', 'Filter', 'Refresh', 'View']) {
    expect(within(actions).getByRole('button', { name })).toBeVisible()
  }
  expect(
    within(actions).queryByRole('button', { name: 'Expand' })
  ).not.toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Expand' }))
  expect(screen.getByRole('button', { name: 'Collapse' })).toHaveAttribute(
    'aria-expanded',
    'true'
  )
  expect(await screen.findByText('Usage')).toBeVisible()
  expect(screen.getByRole('button', { name: date })).toBeVisible()
})

it.each([{ language: 'zhCN', resources: zh.translation }])(
  'labels the calendar-month preset as 本月 in $language and selects the complete month',
  async ({ language, resources }) => {
    // Selecting a preset reads the calendar from the clock, so freeze it too,
    // otherwise the assertion would depend on the day the suite runs.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 8, 12))
    i18next.addResourceBundle(language, 'translation', resources, true, true)
    await i18next.changeLanguage(language)
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <CompactDateTimeRangePicker
        start={new Date(2026, 7, 10)}
        end={new Date(2026, 8, 8)}
        onChange={onChange}
      />
    )
    await user.click(screen.getByRole('button', { name: /^2026/ }))
    const preset = screen.getByRole('button', { name: '本月' })
    expect(preset).toBeVisible()
    expect(preset).toHaveAttribute('aria-pressed', 'false')
    await user.click(preset)
    expect(onChange).toHaveBeenCalledWith({
      start: new Date(2026, 8, 1),
      // The window is second precision, so the last second of the month rather
      // than its last millisecond — the management APIs take seconds anyway.
      end: new Date(2026, 8, 30, 23, 59, 59),
      preset: 'this-month',
    })
  }
)
