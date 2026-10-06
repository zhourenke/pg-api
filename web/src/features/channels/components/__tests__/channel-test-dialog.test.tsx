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
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { channelSchema } from '../../types'
import { ChannelsProvider, useChannels } from '../channels-provider'
import { ChannelTestDialog } from '../dialogs/channel-test-dialog'

const channel = channelSchema.parse({
  id: 7,
  name: 'Test target',
  type: 1,
  key: '',
  status: 1,
  created_time: 1,
  test_time: 0,
  response_time: 0,
  balance_updated_time: 0,
  models: 'gpt-4o-mini,gpt-4o',
  group: 'default',
  base_url: 'https://example.test',
})

function DialogHarness() {
  const { setCurrentRow } = useChannels()

  useEffect(() => setCurrentRow(channel), [setCurrentRow])

  return <ChannelTestDialog open onOpenChange={() => undefined} />
}

function renderDialog() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <QueryClientProvider client={client}>
      <ChannelsProvider>
        <DialogHarness />
      </ChannelsProvider>
    </QueryClientProvider>
  )
  return client
}

type MountedTable = {
  table: HTMLElement
  widthsByColumn: Record<string, string>
}

async function findModelTable(): Promise<MountedTable> {
  const region = await screen.findByRole('region', { name: 'Channel models' })
  const table = within(region).getByRole('table')
  const columnIds = [...table.querySelectorAll('thead th')].map(
    (cell) => cell.getAttribute('data-column-id') ?? ''
  )
  const widths = [...table.querySelectorAll('colgroup col')].map(
    (col) =>
      col
        .getAttribute('style')
        ?.replace(/^width:\s*/, '')
        .replace(/;$/, '') ?? ''
  )

  return {
    table,
    widthsByColumn: Object.fromEntries(
      columnIds.map((columnId, index) => [columnId, widths[index] ?? ''])
    ),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

it('lays the model table out through the shared table', async () => {
  const client = renderDialog()
  const { table, widthsByColumn } = await findModelTable()

  // The dialog used to hand-write this set of widths into a colgroup and into
  // per-column classes; the shared table owns the colgroup, the sizing style and
  // the trailing spacer now, which is what makes the separators, the drag and
  // the double-click fit work here. The only column that declares a width of its
  // own is the result window — the rest are fitted to their content.
  expect(table.style.tableLayout).toBe('fixed')
  expect(widthsByColumn).toHaveProperty('__filler', '')
  expect(widthsByColumn.result).toBe('320px')
  client.clear()
})

it('lets the measured content widen the model column but never the result window', async () => {
  // jsdom lays nothing out, so the measurement reads a scripted width: the
  // model cells need 900px and a failure message would need 4000px.
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      if (this.tagName === 'TH') return 0
      if (this.getAttribute('data-column-id') === 'model') return 900
      if (this.getAttribute('data-column-id') === 'result') return 4000
      return 0
    }
  )

  const client = renderDialog()
  const { widthsByColumn } = await findModelTable()

  await waitFor(() => expect(widthsByColumn).toMatchObject({ model: '916px' }))
  // The result cell is a window rather than content: the 4000px it would
  // measure must not reach the column, so it keeps the width it declares.
  expect(widthsByColumn.result).toBe('320px')
  client.clear()
})

function mockNarrowViewport() {
  const original = window.matchMedia
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: true,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }))
}

it('lays the narrow form out as a card with the model name on top', async () => {
  mockNarrowViewport()
  const client = renderDialog()

  const name = await screen.findByText('gpt-4o-mini')
  expect(screen.queryByRole('table')).toBeNull()
  // The name is the card's title: larger than the rows beneath it.
  expect(name.className).toContain('text-base')
  expect(screen.getAllByText('Not tested')).toHaveLength(2)
  expect(screen.getAllByText('-')).toHaveLength(2)
  // One test button per card, and the shared list keeps the selection UI.
  expect(
    screen.getAllByRole('button', { name: 'Test Connection' })
  ).toHaveLength(2)
  expect(screen.getByText('Select all')).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Select row 1' })).toBeVisible()
  expect(screen.getByRole('checkbox', { name: 'Select row 2' })).toBeVisible()
  client.clear()
})

it('puts a failure summary and its own actions side by side in the narrow card', async () => {
  // A model with no price fails before the request reaches the upstream, so the
  // dialog can be driven into its failure state with a mocked response.
  vi.spyOn(api, 'get').mockResolvedValue({
    data: {
      success: false,
      message: '模型 gpt-4o-mini 的价格未配置。请在「系统设置」中配置。',
      error_code: 'model_price_error',
    },
  })
  mockNarrowViewport()
  const client = renderDialog()

  const buttons = await screen.findAllByRole('button', {
    name: 'Test Connection',
  })
  await userEvent.click(buttons[0])

  const summary = await screen.findByText(
    'Model price is not configured. Please complete model pricing in settings.'
  )
  const settingsButton = screen.getByRole('button', { name: 'Go to Settings' })
  expect(screen.getByRole('button', { name: 'Details' })).toBeVisible()
  expect(screen.getByText('Failed')).toBeVisible()

  // The summary and the actions are two columns of one row: the actions are
  // beside the result, not inside the column that holds it.
  const resultColumn = summary.closest('div.flex-col')
  expect(resultColumn).not.toBeNull()
  expect(resultColumn?.contains(settingsButton)).toBe(false)
  expect(resultColumn?.parentElement?.contains(settingsButton)).toBe(true)
  client.clear()
})
