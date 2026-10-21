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
import { act, render } from '@testing-library/react'
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
    content: 'Test content',
    username: 'test_user',
    token_name: 'test_token',
    model_name: 'claude-3-5-sonnet',
    quota: 5000,
    prompt_tokens: 100,
    completion_tokens: 50,
    use_time: 1500,
    is_stream: false,
    channel: 10,
    channel_name: 'Anthropic Channel',
    token_id: 1,
    group: 'vip',
    ip: '127.0.0.1',
    other: JSON.stringify({}),
    request_id: 'req-1',
    upstream_request_id: '',
    ...overrides,
  }
}

function LogTableHarness(props: { log: UsageLog; isAdmin: boolean }) {
  const columns = useCommonLogsColumns(props.isAdmin, false)
  const table = useReactTable({
    data: [props.log],
    columns,
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

describe('usage logs prompt_tokens column specifications', () => {
  it('renders prompt and completion tokens with tabular numbers and formatted text', () => {
    const { container } = renderLogTable(
      makeLog({
        prompt_tokens: 125000,
        completion_tokens: 4500,
      })
    )

    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    expect(tokensCell).toBeInTheDocument()
    const tokensSpan = tokensCell?.querySelector('span.font-mono')
    expect(tokensSpan).toHaveTextContent('125,000 / 4,500')
    expect(tokensSpan).toHaveClass('tabular-nums')
  })

  it('renders both cache read and write with flex-wrap and full hover title when both are present', () => {
    const { container } = renderLogTable(
      makeLog({
        prompt_tokens: 211452,
        completion_tokens: 1250,
        other: JSON.stringify({
          cache_tokens: 208000,
          cache_creation_tokens: 3452,
        }),
      })
    )

    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    expect(tokensCell).toBeInTheDocument()

    // Cache container should use flex-wrap to avoid being squeezed into ellipsis
    const cacheContainer = tokensCell?.querySelector('div.flex-wrap')
    expect(cacheContainer).toBeInTheDocument()

    // Both read and write numbers should be visible in text
    expect(tokensCell).toHaveTextContent('缓存↓ 208,000')
    expect(tokensCell).toHaveTextContent('↑ 3,452')

    // Root cell element should have a complete title attribute with all token details
    const rootCellDiv = tokensCell?.firstElementChild
    expect(rootCellDiv).toHaveAttribute('title')
    const title = rootCellDiv?.getAttribute('title') ?? ''
    expect(title).toContain('输入 Token: 211,452')
    expect(title).toContain('输出 Token: 1,250')
    expect(title).toContain('缓存读取: 208,000')
    expect(title).toContain('缓存写入: 3,452')
  })

  it('renders cache read alone with cache label and arrow', () => {
    const { container } = renderLogTable(
      makeLog({
        prompt_tokens: 50000,
        completion_tokens: 800,
        other: JSON.stringify({
          cache_tokens: 48000,
        }),
      })
    )

    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    expect(tokensCell).toHaveTextContent('缓存↓ 48,000')

    const rootCellDiv = tokensCell?.firstElementChild
    const title = rootCellDiv?.getAttribute('title') ?? ''
    expect(title).toContain('缓存读取: 48,000')
    expect(title).not.toContain('缓存写入')
  })

  it('renders cache write alone with cache label and arrow', () => {
    const { container } = renderLogTable(
      makeLog({
        prompt_tokens: 12000,
        completion_tokens: 300,
        other: JSON.stringify({
          cache_creation_tokens: 11000,
        }),
      })
    )

    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    // Should clearly show cache prefix rather than bare arrow
    expect(tokensCell).toHaveTextContent('缓存↑ 11,000')

    const rootCellDiv = tokensCell?.firstElementChild
    const title = rootCellDiv?.getAttribute('title') ?? ''
    expect(title).toContain('缓存写入: 11,000')
    expect(title).not.toContain('缓存读取')
  })

  it('supports split 5m and 1h cache write in title breakdown', () => {
    const { container } = renderLogTable(
      makeLog({
        prompt_tokens: 30000,
        completion_tokens: 100,
        other: JSON.stringify({
          cache_creation_tokens_5m: 5000,
          cache_creation_tokens_1h: 25000,
        }),
      })
    )

    const tokensCell = container.querySelector(
      '[data-column-id="prompt_tokens"]'
    )
    // Total write displayed in cell
    expect(tokensCell).toHaveTextContent('缓存↑ 30,000')

    // Breakdown displayed in title
    const rootCellDiv = tokensCell?.firstElementChild
    const title = rootCellDiv?.getAttribute('title') ?? ''
    expect(title).toContain('缓存写入 (5m): 5,000')
    expect(title).toContain('缓存写入 (1h): 25,000')
  })

  it('configures prompt_tokens column with window measurement and recommended width', () => {
    let columns: ReturnType<typeof useCommonLogsColumns> | undefined
    function ColumnsInspector() {
      columns = useCommonLogsColumns(true, false)
      return null
    }
    render(
      <QueryClientProvider client={client}>
        <UsageLogsProvider>
          <ColumnsInspector />
        </UsageLogsProvider>
      </QueryClientProvider>
    )

    const promptTokensColumn = columns?.find(
      (col) =>
        ('accessorKey' in col && col.accessorKey === 'prompt_tokens') ||
        col.id === 'prompt_tokens'
    )
    expect(promptTokensColumn).toBeDefined()
    expect(promptTokensColumn?.size).toBe(160)
    expect(promptTokensColumn?.meta?.measurement).toBe('window')
  })
})
