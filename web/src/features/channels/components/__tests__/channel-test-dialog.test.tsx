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
import { useEffect } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

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

it('takes the model table widths from the column definitions through the shared colgroup', async () => {
  const client = renderDialog()
  const { table, widthsByColumn } = await findModelTable()

  // The dialog used to hand-write this set of widths into a colgroup and into
  // per-column classes; both are now the column definitions' own sizes.
  expect(widthsByColumn).toMatchObject({
    select: '40px',
    model: '192px',
    status: '112px',
    result: '320px',
  })
  // And it is the shared table that lays the columns out, which is what makes
  // the separators, the drag and the double-click fit work here.
  expect(table.style.tableLayout).toBe('fixed')
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
  // The result cell is a wrapping window, so its length must not reach the
  // column: the declared maximum keeps it at the width it was designed with.
  expect(widthsByColumn.result).toBe('320px')
  client.clear()
})
