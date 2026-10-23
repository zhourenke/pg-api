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
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { SystemInstancesPanel } from '../components/system-instances-panel'

const onlineInstance = {
  node_name: 'node-1',
  status: 'online',
  stale_after_seconds: 60,
  started_at: 1_700_000_000,
  last_seen_at: 1_700_000_100,
  info: {
    node: { name: 'instance-online' },
    host: { hostname: 'host-online' },
    runtime: { version: '1.2.3', goos: 'linux', goarch: 'amd64' },
    resources: { cpu: { usage_percent: 12.3 } },
  },
}

const staleInstance = {
  node_name: 'node-2',
  status: 'stale',
  stale_after_seconds: 60,
  started_at: 1_700_000_000,
  last_seen_at: 1_700_000_100,
  info: {
    node: { name: 'instance-stale' },
    host: { hostname: 'host-stale' },
  },
}

function mockInstances() {
  return vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, message: '', data: [onlineInstance, staleInstance] },
  })
}

function mockViewport(isNarrow: boolean) {
  const original = window.matchMedia
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: isNarrow,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

function renderPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <SystemInstancesPanel />
    </QueryClientProvider>
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('lists instances in the shared table on wide viewports', async () => {
  mockViewport(false)
  mockInstances()
  const client = renderPanel()

  expect(await screen.findByRole('table')).toBeVisible()
  expect(
    screen.getByRole('button', { name: 'Fit column widths' })
  ).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Instances' })).toBeVisible()
  expect(screen.getByText('instance-online')).toBeVisible()
  expect(screen.getByText('host-online')).toBeVisible()

  // Status preserves indicator dot and truncates text
  const statusBadge = screen
    .getByText('online')
    .closest('[data-slot="badge"]') as HTMLElement
  expect(statusBadge.className).toContain('min-w-0')
  const statusDot = statusBadge.querySelector(
    'span[aria-hidden="true"]'
  ) as HTMLElement
  expect(statusDot.className).toContain('shrink-0')
  const statusText = screen.getByText('online')
  expect(statusText.className).toContain('min-w-0')
  expect(statusText.className).toContain('truncate')

  // CPU prioritizes preserving percentage and compresses icon
  const cpuPercent = screen.getByText('12.3%')
  expect(cpuPercent.className).toContain('min-w-0')
  expect(cpuPercent.className).toContain('truncate')
  const cpuSvg = cpuPercent.parentElement?.querySelector('svg')
  expect(cpuSvg?.getAttribute('class')).toContain('shrink')
  expect(cpuSvg?.getAttribute('class')).toContain('min-w-0')

  client.clear()
})

it('lists instances as the shared card list on narrow viewports', async () => {
  mockViewport(true)
  mockInstances()
  const client = renderPanel()

  expect(await screen.findByText('instance-online')).toBeVisible()
  expect(screen.queryByRole('table')).toBeNull()
  // The narrow form is the shared list, not a bespoke layout.
  expect(screen.getByText('instance-online').closest('div.divide-y')).not.toBe(
    null
  )
  expect(screen.getByText('host-online')).toBeVisible()
  expect(screen.getByText('online')).toBeVisible()
  expect(screen.getByText('stale')).toBeVisible()
  // A stale instance stays deletable without a table to act in.
  expect(
    screen.getByRole('button', { name: 'Delete stale instance' })
  ).toBeVisible()
  client.clear()
})
