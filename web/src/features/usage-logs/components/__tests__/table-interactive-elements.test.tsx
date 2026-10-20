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
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import { act, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'

import zhCN from '@/i18n/locales/zh.json'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import type { UsageLog } from '../../data/schema'
import { useCommonLogsColumns } from '../columns/common-logs-columns'
import { StreamTpsCell } from '../timing-metrics-cell'
import { UsageLogsProvider } from '../usage-logs-provider'

vi.mock('@lobehub/icons', () => ({}))
vi.hoisted(() => {
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  })
})
afterAll(() => vi.unstubAllGlobals())

function makeLog(overrides?: Partial<UsageLog>): UsageLog {
  return {
    id: 1,
    user_id: 42,
    created_at: 1711800000,
    type: 2,
    content: 'Full detailed content for testing',
    username: 'test_user',
    token_name: 'test_token',
    model_name: 'gpt-4o',
    quota: 5000,
    prompt_tokens: 100,
    completion_tokens: 50,
    use_time: 1500,
    is_stream: false,
    channel: 10,
    channel_name: 'Test Channel',
    token_id: 1,
    group: 'vip',
    ip: '127.0.0.1',
    other: JSON.stringify({
      response_model: {
        requested_model: 'gpt-4o',
        returned_model: 'gpt-4o-2024-05-13',
      },
    }),
    request_id: 'req-1',
    upstream_request_id: '',
    ...overrides,
  }
}

function LogTableHarness(props: { log: UsageLog; isAdmin: boolean }) {
  const table = useReactTable({
    data: [props.log],
    columns: useCommonLogsColumns(props.isAdmin, false),
    getCoreRowModel: getCoreRowModel(),
  })

  return (
    <table>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id} data-column-id={cell.column.id}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

const previousConfig = useSystemConfigStore.getState().config
let client: QueryClient

beforeEach(async () => {
  act(() => {
    i18next.addResourceBundle(
      'zhCN',
      'translation',
      zhCN.translation,
      true,
      true
    )
  })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(['status'], {}, { updatedAt: Date.now() + 60_000 })
  client.setQueryData(
    ['pricing'],
    { data: [], vendors: [] },
    { updatedAt: Date.now() + 60_000 }
  )
})

afterEach(() => {
  client.clear()
  useSystemConfigStore.getState().setConfig(previousConfig)
  act(() => {
    i18next.removeResourceBundle('zhCN', 'translation')
  })
})

function renderLogTable(log = makeLog(), isAdmin = true) {
  return render(
    <QueryClientProvider client={client}>
      <UsageLogsProvider>
        <LogTableHarness log={log} isAdmin={isAdmin} />
      </UsageLogsProvider>
    </QueryClientProvider>
  )
}

describe('table interactive elements and styling specifications', () => {
  it('channel cell renders directly without redundant outer tooltip wrapper or ellipsis', () => {
    const { container } = renderLogTable()
    const channelCell = container.querySelector('[data-column-id="channel"]')
    expect(channelCell).toBeInTheDocument()
    // Does not wrap the whole cell in a TooltipTrigger
    expect(
      channelCell?.querySelector('[data-slot="tooltip-trigger"]')
    ).toBeNull()
    // Contains badge and channel name directly
    expect(channelCell).toHaveTextContent('#10')
    expect(channelCell).toHaveTextContent('Test Channel')
    // Channel name has truncate for column squeezing
    const channelNameSpan = channelCell?.querySelector(
      'span.text-muted-foreground\\/70'
    )
    expect(channelNameSpan).toHaveClass('truncate')
  })

  it('user cell displays username with text-foreground color, cursor-pointer, and native title 点击查看详细信息', () => {
    const { container } = renderLogTable()
    const userCell = container.querySelector('[data-column-id="user"]')
    const userBtn = userCell?.querySelector('button')
    expect(userBtn).toBeInTheDocument()
    expect(userBtn).toHaveAttribute('title', '点击查看详细信息')
    expect(userBtn).toHaveClass('cursor-pointer')

    const usernameSpan = userBtn?.querySelector('span.text-foreground')
    expect(usernameSpan).toBeInTheDocument()
    expect(usernameSpan).not.toHaveClass('text-muted-foreground')
    expect(usernameSpan).toHaveClass('truncate')
  })

  it('token badge has title 点击复制, cursor-pointer, and token group has no browser native title', () => {
    const { container } = renderLogTable()
    const tokenCell = container.querySelector('[data-column-id="token_name"]')
    const tokenBadge = tokenCell?.querySelector('[data-slot="status-badge"]')
    expect(tokenBadge).toBeInTheDocument()
    expect(tokenBadge).toHaveAttribute('title', '点击复制')
    expect(tokenBadge).toHaveClass('cursor-pointer')
    expect(tokenBadge).not.toHaveClass('cursor-copy')

    // Group badge should have no title attribute
    const groupBadge = tokenCell?.querySelectorAll(
      '[data-slot="status-badge"]'
    )[1]
    expect(groupBadge).toBeInTheDocument()
    expect(groupBadge).not.toHaveAttribute('title')
  })

  it('model column button has w-fit, title 点击查看详细信息, cursor-pointer, and container has items-start', () => {
    const { container } = renderLogTable()
    const modelCell = container.querySelector('[data-column-id="model_name"]')
    const modelContainer = modelCell?.firstElementChild
    expect(modelContainer).toHaveClass('items-start')

    const modelBtn = modelCell?.querySelector('button')
    expect(modelBtn).toBeInTheDocument()
    expect(modelBtn).toHaveAttribute('title', '点击查看详细信息')
    expect(modelBtn).toHaveClass('w-fit', 'cursor-pointer')
  })

  it('log details column has title 点击查看详细信息, cursor-pointer, no常态underline, and only hover:underline on text', () => {
    const { container } = renderLogTable()
    const detailsCell = container.querySelector('[data-column-id="content"]')
    const detailsBtn = detailsCell?.querySelector('button')
    expect(detailsBtn).toBeInTheDocument()
    expect(detailsBtn).toHaveAttribute('title', '点击查看详细信息')
    expect(detailsBtn).toHaveClass('cursor-pointer')
    expect(detailsBtn).not.toHaveClass('group')

    const previewSpan = detailsBtn?.querySelector('span')
    expect(previewSpan).toHaveClass('no-underline', 'hover:underline')
    expect(previewSpan).not.toHaveClass('group-hover:underline')
  })

  it('burst indicator renders lightning trigger with soft amber color, cursor-help, no underline, and scoped group/burst', () => {
    render(
      <StreamTpsCell
        isStream
        throughput={{
          tokensPerSecond: null,
          isBurst: true,
          outputMs: 46,
          overallTokensPerSecond: 42.4,
        }}
      />
    )

    // First line shows stream label
    expect(screen.getByText('流')).toBeInTheDocument()

    // Second line shows lightning icon button and t/s
    const burstTrigger = screen.getByRole('button', { name: '脉冲流式' })
    expect(burstTrigger).toBeInTheDocument()
    expect(burstTrigger).toHaveClass(
      'group/burst',
      'cursor-help',
      'text-amber-600/70',
      'dark:text-amber-400/70'
    )
    expect(burstTrigger).not.toHaveClass('underline', 'hover:underline')

    const zapIcon = burstTrigger.querySelector('svg')
    expect(zapIcon).toHaveClass(
      'group-hover/burst:fill-amber-500/80',
      'dark:group-hover/burst:fill-amber-400/80'
    )
    expect(zapIcon).not.toHaveClass('group-hover:fill-amber-500/80')

    const tpsSpan = screen.getByText('t/s')
    expect(tpsSpan).toBeInTheDocument()
    expect(tpsSpan).not.toHaveClass('cursor-help')
  })

  it('verifies ellipsis and truncation support across time, channel, token, tokens, timing, and log details', () => {
    const { container } = renderLogTable(
      makeLog({
        created_at: 1729259380,
        prompt_tokens: 211452,
        completion_tokens: 50,
        other: JSON.stringify({
          cache_tokens: 208000,
          billing_mode: 'tiered_expr',
          price_entries: [
            { field: 'inputPrice', value: 0.15 },
            { field: 'outputPrice', value: 0.75 },
            { field: 'cacheReadPrice', value: 1.25 },
          ],
        }),
      })
    )

    // 1. Time column date has truncate
    const timeCell = container.querySelector('[data-column-id="created_at"]')
    const timeSpan = timeCell?.querySelector('span.font-mono')
    expect(timeSpan).toHaveClass('truncate', 'min-w-0')

    // 2. Channel column name has truncate
    const channelCell = container.querySelector('[data-column-id="channel"]')
    const channelNameSpan = channelCell?.querySelector(
      'span.text-muted-foreground\\/70'
    )
    expect(channelNameSpan).toHaveClass('truncate', 'min-w-0')

    // 3. Token column group has truncate
    const tokenCell = container.querySelector('[data-column-id="token_name"]')
    const tokenGroupSpan = tokenCell?.querySelector(
      'span.text-xs.leading-normal'
    )
    expect(tokenGroupSpan).toHaveClass('min-w-0')

    // 4. Tokens column prompt/completion and cache tokens have truncate
    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    const tokensCountSpan = tokensCell?.querySelector('span.font-mono')
    expect(tokensCountSpan).toHaveClass('truncate', 'min-w-0')
    const cacheTokensSpan = tokensCell?.querySelector(
      'span.text-muted-foreground\\/60'
    )
    expect(cacheTokensSpan).toHaveClass('truncate', 'min-w-0')

    // 5. Timing column labels have truncate
    const timingCell = container.querySelector('[data-column-id="use_time"]')
    const generateLabel = timingCell?.querySelector(
      'span.text-muted-foreground'
    )
    expect(generateLabel).toHaveClass('truncate', 'min-w-0')

    // 6. Log details primary text has truncate
    const detailsCell = container.querySelector('[data-column-id="content"]')
    const detailsText = detailsCell?.querySelector('span.truncate')
    expect(detailsText).toBeInTheDocument()
  })
})
