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
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UsageLog } from '../../data/schema'
import type { LogOtherData } from '../../types'
import { DetailsDialog } from '../dialogs/details-dialog'

const queryClients: QueryClient[] = []
const previousConfig = useSystemConfigStore.getState().config

function makeLog(other: LogOtherData): UsageLog {
  return {
    id: 1,
    user_id: 1,
    created_at: 1,
    type: 2,
    content: '',
    username: 'user',
    token_name: 'token',
    model_name: 'gpt-test',
    quota: 100,
    prompt_tokens: 10,
    completion_tokens: 500,
    use_time: 10,
    is_stream: false,
    channel: 1,
    channel_name: 'channel',
    token_id: 1,
    group: 'default',
    ip: '',
    other: JSON.stringify(other),
    request_id: 'req-1',
    upstream_request_id: '',
  }
}

function renderDetails(other: LogOtherData): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  queryClient.setQueryData(['status'], {}, { updatedAt: Date.now() + 60_000 })
  queryClients.push(queryClient)

  render(
    <QueryClientProvider client={queryClient}>
      <DetailsDialog
        log={makeLog(other)}
        isAdmin
        isRoot={false}
        open
        onOpenChange={() => undefined}
      />
    </QueryClientProvider>
  )
}

afterEach(() => {
  for (const queryClient of queryClients) {
    queryClient.clear()
  }
  queryClients.length = 0
  useSystemConfigStore.getState().setConfig(previousConfig)
})

/**
 * A price and its label belong to the same row, and the dialog also labels the
 * cache *token count* "Cache Read", so each assertion is scoped to the row the
 * price sits in instead of querying the label on its own.
 */
function expectRowWithLabel(price: string, label: string): void {
  const row = screen.getByText(price).closest('.grid')
  expect(row?.textContent).toContain(label)
}

describe('usage log billing breakdown', () => {
  test('lists the cache price for a standard-ratio log that read the cache', () => {
    useSystemConfigStore
      .getState()
      .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
    renderDetails({
      model_ratio: 1,
      completion_ratio: 2,
      cache_tokens: 100,
      cache_ratio: 0.1,
    })

    expectRowWithLabel('$2/M', 'Input')
    expectRowWithLabel('$4/M', 'Output')
    // The same price the details column previews, so the dialog has to account
    // for it too.
    expectRowWithLabel('$0.2/M', 'Cache Read')
  })

  test('leaves the cache price out for a log that never read the cache', () => {
    useSystemConfigStore
      .getState()
      .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
    renderDetails({
      model_ratio: 1,
      completion_ratio: 2,
      cache_ratio: 0.1,
    })

    expect(screen.getByText('$2/M')).toBeInTheDocument()
    expect(screen.queryByText('$0.2/M')).toBeNull()
  })

  test('still lists the cache write prices a Claude log charges', () => {
    useSystemConfigStore
      .getState()
      .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
    renderDetails({
      claude: true,
      model_ratio: 1,
      completion_ratio: 3,
      cache_tokens: 100,
      cache_creation_tokens_5m: 50,
      cache_creation_ratio: 1.25,
      cache_creation_ratio_1h: 2,
    })

    expectRowWithLabel('$6/M', 'Output')
    expectRowWithLabel('$2.5/M', 'Cache Creation')
    expectRowWithLabel('$4/M', 'Cache Creation (1h)')
  })
})
