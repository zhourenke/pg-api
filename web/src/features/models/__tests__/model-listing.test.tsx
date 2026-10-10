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
  createRootRoute,
  createRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from '@tanstack/react-router'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  render,
  screen,
  within,
  cleanup,
  waitFor,
  act,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from 'i18next'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type {
  ModelPricingConfig,
  ModelPricingEntry,
} from '@/features/model-pricing/api'
import { pricingOptions } from '@/features/model-pricing/pricing'
import { usePricingColumns } from '@/features/pricing/components/pricing-columns'
import type { PricingModel } from '@/features/pricing/types'
import zhCN from '@/i18n/locales/zh.json'
import { api } from '@/lib/api'
import { useAuthStore } from '@/stores/auth-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'

import { useModelsColumns } from '../components/models-columns'
import { ModelsDialogs } from '../components/models-dialogs'
import { ModelsProvider } from '../components/models-provider'
import { ModelsTable } from '../components/models-table'
import type { Model } from '../types'

const metadata: Model = {
  id: 7,
  model_name: 'catalog-only',
  square_state: 'unavailable',
  has_metadata: true,
  configured_channel_count: 0,
  name_rule: 0,
  status: 1,
  sync_official: 1,
  created_time: 1,
  updated_time: 1,
}
const channel: Model = {
  ...metadata,
  id: 0,
  model_name: 'channel-only',
  has_metadata: false,
  configured_channel_count: 1,
  status: 0,
  sync_official: 0,
}
const clients: QueryClient[] = []

function Page() {
  return (
    <ModelsProvider>
      <ModelsTable />
      <ModelsDialogs />
    </ModelsProvider>
  )
}

function CatalogPrice(props: { model: PricingModel }) {
  const columns = usePricingColumns({ tokenUnit: 'M' })
  const table = useReactTable({
    data: [props.model],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const cell = table
    .getRowModel()
    .rows[0].getAllCells()
    .find((item) => item.column.id === 'price')
  return (
    <div role='group' aria-label='Catalog price'>
      {cell && flexRender(cell.column.columnDef.cell, cell.getContext())}
    </div>
  )
}

function DisplayPolicyCell(props: { model: Model }) {
  const columns = useModelsColumns()
  const table = useReactTable({
    data: [props.model],
    columns,
    getCoreRowModel: getCoreRowModel(),
  })
  const cell = table
    .getRowModel()
    .rows[0].getAllCells()
    .find((item) => item.column.id === 'status')
  return (
    <div role='group' aria-label='Display policy cell'>
      {cell && flexRender(cell.column.columnDef.cell, cell.getContext())}
    </div>
  )
}

async function renderList(
  items: Model[] = [
    metadata,
    channel,
    { ...channel, model_name: 'other-channel' },
  ],
  options: {
    pricing?: ModelPricingEntry[] | Promise<ModelPricingConfig>
    waitForPricing?: boolean
    initialUrl?: string
    total?: number
  } = {}
) {
  useAuthStore.getState().auth.setUser({ id: 1, username: 'admin', role: 100 })
  const get = vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/models/' || url === '/api/models/search') {
      return {
        data: {
          success: true,
          data: { items, total: options.total ?? items.length },
        },
      }
    }
    if (url === '/api/models/7') {
      return { data: { success: true, data: metadata } }
    }
    if (url === '/api/option/model_pricing') {
      return {
        data: {
          success: true,
          data:
            options.pricing && !Array.isArray(options.pricing)
              ? await options.pricing
              : {
                  entries: options.pricing ?? [],
                  options: pricingOptions({}),
                  empty_version: 'empty',
                },
        },
      }
    }
    return { data: { success: true, data: { items: [] } } }
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  clients.push(client)
  const root = createRootRoute()
  const authenticated = createRoute({
    getParentRoute: () => root,
    id: '_authenticated',
  })
  const models = createRoute({
    getParentRoute: () => authenticated,
    path: 'models/$section',
    component: Page,
  })
  const router = createRouter({
    routeTree: root.addChildren([authenticated.addChildren([models])]),
    history: createMemoryHistory({
      initialEntries: [options.initialUrl ?? '/models/metadata'],
    }),
  })
  await router.load()
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
  if (items.length) {
    await screen.findByRole('button', { name: items[0].model_name })
  } else await screen.findByText('No Models Found')
  if (options.waitForPricing !== false) {
    await waitFor(() => expect(client.isFetching()).toBe(0))
  }
  return { ...result, get, router }
}

beforeEach(() => {
  useSystemConfigStore.getState().setConfig({
    currency: { ...DEFAULT_CURRENCY_CONFIG, quotaDisplayType: 'USD' },
  })
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(async () => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  useAuthStore.getState().auth.reset()
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
})

it('requests channel models and distinguishes catalog policy from availability using compact labels', async () => {
  const { get } = await renderList()
  expect(get).toHaveBeenCalledWith('/api/models/', {
    params: expect.objectContaining({ include_channel_models: true }),
  })
  expect(screen.getAllByText('Unavailable')).toHaveLength(3)
  const warning = screen
    .getAllByText('Unavailable')[0]
    .closest('[data-slot="status-badge"]')
  expect(warning).toHaveClass('text-warning')
  expect(warning?.querySelector('svg')).toBeNull()
  expect(warning).not.toHaveClass('text-success')
  expect(screen.getAllByText('Missing metadata')).toHaveLength(2)
  expect(screen.getAllByText('Channels 0 · Groups 0')).toHaveLength(3)
  expect(
    screen.queryByText(
      'No channel is configured. This model will not appear in the model square.'
    )
  ).not.toBeInTheDocument()
  const user = userEvent.setup()
  const trigger = screen.getAllByRole('button', {
    name: 'Unavailable',
  })[0]
  expect(trigger).toHaveAttribute(
    'title',
    'No channel is configured. This model will not appear in the model square.'
  )
  await user.click(trigger)
  expect(
    await screen.findByRole('dialog', { name: 'Unavailable' })
  ).toHaveTextContent(
    'No channel is configured. This model will not appear in the model square.'
  )
  expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await user.keyboard('{Escape}')
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Unavailable' })
    ).not.toBeInTheDocument()
  )
  expect(trigger).toHaveFocus()
  await user.click(screen.getByRole('button', { name: 'catalog-only' }))
  await user.click(screen.getByRole('tab', { name: 'Channels and groups' }))
  expect(
    screen.getByText(
      'No channel is configured. This model will not appear in the model square.'
    )
  ).toBeVisible()
})

it('keeps channel rows individually selectable and disables metadata mutations for mixed selection', async () => {
  await renderList()
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('checkbox', { name: 'Select channel-only' })
  )
  expect(
    screen.getByRole('checkbox', { name: 'Select channel-only' })
  ).toBeChecked()
  expect(
    screen.getByRole('checkbox', { name: 'Select other-channel' })
  ).not.toBeChecked()
  await user.click(
    screen.getByRole('checkbox', { name: 'Select catalog-only' })
  )
  expect(
    screen.getByRole('checkbox', { name: 'Select channel-only' })
  ).toBeChecked()
  const toolbar = screen.getByRole('toolbar', { name: /Bulk actions/ })
  for (const name of [
    'Change vendor',
    'Clear vendor',
    'Show selected models in model square',
    'Hide selected models from model square',
    'Delete selected models',
  ]) {
    expect(within(toolbar).getByRole('button', { name })).toBeDisabled()
  }
  expect(
    within(toolbar).getByRole('button', { name: 'Copy model names' })
  ).toBeEnabled()
  await user.click(
    screen.getByRole('checkbox', { name: 'Select channel-only' })
  )
  expect(
    within(toolbar).getByRole('button', { name: 'Delete selected models' })
  ).toBeEnabled()
})

it('keeps long model names and translated channel labels truncated inside their existing cells', async () => {
  const longName =
    'provider/very-long-channel-model-with-detailed-version-and-context-window'
  await renderList([
    { ...channel, model_name: longName },
    { ...metadata, status: 0, square_state: 'hidden' },
  ])
  expect(screen.getByText(longName)).toHaveClass('truncate')
  // 操作列按内容自适应宽度，按钮文字不允许被截断，否则这一列会被压到 0 宽
  for (const label of screen.getAllByText('Model info')) {
    expect(label).not.toHaveClass('truncate')
    expect(label).toHaveClass('whitespace-nowrap')
  }
  const label = screen.getAllByText(
    i18n.t('Channels {{channels}} · Groups {{groups}}', {
      channels: 0,
      groups: 0,
    })
  )[0]
  expect(label).toHaveClass('whitespace-normal', 'sm:truncate')
  expect(label).toHaveAttribute('tabindex', '0')
  await act(async () => {
    i18n.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
    await i18n.changeLanguage('zhCN')
  })
  expect(screen.getByText('缺元数据')).toBeVisible()
  expect(screen.getByText('已隐藏')).toBeVisible()
  expect(screen.getAllByText('渠道 0 · 分组 0')).toHaveLength(2)
})

it('keeps all four row actions visible inside the content-sized actions column', async () => {
  await renderList([{ ...metadata, status: 0, square_state: 'hidden' }])
  const actions = screen
    .getByRole('button', { name: 'Model info' })
    .closest('[data-column-id="actions"]')
  expect(actions).not.toBeNull()
  for (const name of ['Model info', 'Price', 'Show', 'Delete']) {
    expect(
      within(actions as HTMLElement).getByRole('button', { name })
    ).toBeVisible()
  }
  const grid = (actions as HTMLElement).querySelector('.grid')
  expect(grid).toHaveClass('grid-cols-2')
  // 间距契约：行节距 22px（对齐价格列两行：文字盒 20px + 可见间隙 2px），
  // 列方向左右各 8px 内边距（可见间距约 17px，对齐【API 密钥】操作列的 16-18px）。
  expect(grid).toHaveClass('gap-x-0')
  expect(grid).toHaveClass('gap-y-0')
  expect(grid).toHaveClass('[&>button]:h-[22px]')
  expect(grid).toHaveClass('[&>button]:px-2')
  // 该列由内容撑开：`w-full` / `min-w-0` / `truncate` 会让浏览器把它压到 0 宽，
  // 结果就是整列操作在界面上完全不可见。
  expect(grid).not.toHaveClass('w-full')
  expect(grid?.querySelector('.min-w-0')).toBeNull()
  expect(grid?.querySelector('.truncate')).toBeNull()
})

it('hides a channel-only model the catalog lists by creating its record with the policy off', async () => {
  await renderList([
    {
      ...channel,
      square_state: 'visible',
      bound_channels: [{ name: 'Active', type: 1 }],
    },
  ])
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...channel, id: 9, has_metadata: true } },
  })
  const actions = screen
    .getByRole('button', { name: 'Model info' })
    .closest('[data-column-id="actions"]') as HTMLElement
  // 它确实正在广场上（有可用渠道 + 有价），所以「隐藏」要能按：这一按建立元数据记录、
  // 并把展示策略直接写成隐藏，这是唯一能把它从广场移走的动作。
  const hide = within(actions).getByRole('button', { name: 'Hide' })
  expect(hide).toBeEnabled()
  await userEvent.setup().click(hide)
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/models/',
      expect.objectContaining({
        model_name: 'channel-only',
        name_rule: 0,
        status: 0,
      }),
      expect.anything()
    )
  )
})

it('keeps the action disabled for a channel-only model the catalog does not list', async () => {
  await renderList([{ ...channel, square_state: 'unavailable' }])
  const post = vi.spyOn(api, 'post')
  const actions = screen
    .getByRole('button', { name: 'Model info' })
    .closest('[data-column-id="actions"]') as HTMLElement
  // 不在广场上就没有可隐藏的东西，而元数据也改不动它的可见性（可见性由可用渠道与
  // 计费配置决定），所以这一格保持禁用。
  expect(within(actions).getByRole('button', { name: 'Show' })).toBeDisabled()
  expect(within(actions).getByRole('button', { name: 'Delete' })).toBeDisabled()
  expect(post).not.toHaveBeenCalled()
})

it('leaves the display policy blank for a row that has no policy of its own', () => {
  // 这一列默认是收起的（`models-table.tsx` 的 `initialColumnVisibility.status`），
  // 所以只能直接渲染该列的单元格来钉住它：只存在于渠道的行没有自己的展示策略，
  // `status` 只是零值，据此说它「隐藏」会与同一行「正常展示」的广场状态互相矛盾。
  const view = (model: Model) =>
    render(
      <ModelsProvider>
        <DisplayPolicyCell model={model} />
      </ModelsProvider>
    )
  view({ ...channel, square_state: 'visible' })
  expect(
    within(
      screen.getByRole('group', { name: 'Display policy cell' })
    ).getByText('—')
  ).toBeVisible()
  cleanup()
  // 有元数据记录的行照旧显示策略，`status: 1` 是允许、`0` 是隐藏。
  view({ ...metadata, status: 1 })
  expect(
    within(
      screen.getByRole('group', { name: 'Display policy cell' })
    ).getByText('Allowed')
  ).toBeVisible()
  cleanup()
  view({ ...metadata, status: 0 })
  expect(
    within(
      screen.getByRole('group', { name: 'Display policy cell' })
    ).getByText('Not listed')
  ).toBeVisible()
})

it('prefills and creates metadata only when the user explicitly saves it', async () => {
  await renderList([channel])
  const post = vi.spyOn(api, 'post').mockResolvedValue({
    data: { success: true, data: { ...channel, id: 9, has_metadata: true } },
  })
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'Model info' }))
  expect(screen.getByRole('textbox', { name: 'Model Name *' })).toHaveValue(
    'channel-only'
  )
  expect(post).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'Save metadata' }))
  await waitFor(() =>
    expect(post).toHaveBeenCalledWith(
      '/api/models/',
      expect.objectContaining({ model_name: 'channel-only' }),
      expect.anything()
    )
  )
})

it('keeps prices and channel explanations readable in the mobile card and detail drawer', async () => {
  const originalMatchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...originalMatchMedia(query),
    matches: query === '(max-width: 640px)',
  }))
  await renderList([metadata], {
    pricing: [
      {
        model_name: metadata.model_name,
        version: 'v1',
        configured: {},
        effective: { ModelRatio: 0.625, CompletionRatio: 8 },
      },
    ],
  })
  const price = screen.getByRole('button', {
    name: 'View pricing for catalog-only',
  })
  expect(within(price).getByText('$1.25')).toBeVisible()
  // The token unit is appended to the last price line instead of occupying a
  // line of its own, so the mobile card stays compact.
  expect(within(price).getByText('/ 1M')).toBeVisible()
  expect(screen.getByText('Channels 0 · Groups 0')).toHaveClass(
    'whitespace-normal'
  )
  const user = userEvent.setup()
  await user.click(screen.getByRole('button', { name: 'catalog-only' }))
  await user.click(screen.getByRole('tab', { name: 'Channels and groups' }))
  expect(
    screen.getByText(
      'No channel is configured. This model will not appear in the model square.'
    )
  ).toBeVisible()
})

it('names a missing price as the reason an unavailable model is not shown', async () => {
  await renderList([
    {
      ...metadata,
      model_name: 'unpriced-route',
      configured_channel_count: 1,
      has_billing_config: false,
    },
  ])
  // 精确相等同时钉住两件事：说清了未配置价格，也没有把原因错报成没有渠道。
  expect(
    screen
      .getByRole('button', { name: 'Unavailable' })
      .getAttribute('aria-description')
  ).toBe(
    'No price is configured. This model will not appear in the model square.'
  )
})

it('lists the missing price and the missing channel together', async () => {
  await renderList([
    {
      ...metadata,
      model_name: 'unpriced-without-channel',
      configured_channel_count: 0,
      has_billing_config: false,
    },
  ])
  expect(
    screen
      .getByRole('button', { name: 'Unavailable' })
      .getAttribute('aria-description')
  ).toBe(
    'No price is configured. This model will not appear in the model square. No channel is configured. This model will not appear in the model square.'
  )
})

it('uses backend square states for success, warning, hidden, and partial rows including models without metadata', async () => {
  const activeChannels = [{ name: 'Active', type: 1 }]
  await renderList([
    { ...metadata, model_name: 'catalog-only' },
    {
      ...metadata,
      id: 8,
      model_name: 'enabled-model',
      square_state: 'visible',
      configured_channel_count: 1,
      bound_channels: activeChannels,
    },
    {
      ...metadata,
      id: 9,
      model_name: 'hidden-model',
      status: 0,
      square_state: 'hidden',
      configured_channel_count: 1,
      bound_channels: activeChannels,
    },
    {
      ...metadata,
      id: 10,
      model_name: 'partial-rule-',
      name_rule: 1,
      square_state: 'partial',
      configured_channel_count: 2,
      bound_channels: activeChannels,
    },
    {
      ...channel,
      model_name: 'bare-visible',
      square_state: 'visible',
      bound_channels: activeChannels,
    },
    {
      ...channel,
      model_name: 'bare-hidden-by-rule',
      square_state: 'hidden',
      bound_channels: activeChannels,
    },
  ])
  expect(screen.getByRole('button', { name: 'Display policy' })).toBeVisible()
  for (const label of ['Unavailable', 'Partly shown']) {
    const badge = screen.getByText(label).closest('[data-slot="status-badge"]')
    expect(badge).toHaveClass('text-warning')
    // 警示色本身已经足够醒目，状态徽标不再渲染三角感叹号图标
    expect(badge?.querySelector('svg')).toBeNull()
    expect(badge).not.toHaveClass('text-success')
  }
  const displayed = screen.getAllByText('Displayed')
  expect(displayed).toHaveLength(2)
  for (const label of displayed) {
    expect(label.closest('[data-slot="status-badge"]')).toHaveClass(
      'text-success'
    )
  }
  const hidden = screen.getAllByText('Listing hidden')
  expect(hidden).toHaveLength(2)
  for (const label of hidden) {
    expect(label.closest('[data-slot="status-badge"]')).toHaveClass(
      'text-muted-foreground'
    )
  }
  await act(async () => {
    i18n.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
    await i18n.changeLanguage('zhCN')
  })
  expect(screen.getByText('无法展示')).toBeVisible()
  expect(screen.getByText('部分展示')).toBeVisible()
  expect(screen.getAllByText('正常展示')).toHaveLength(2)
  expect(screen.getAllByText('已隐藏')).toHaveLength(2)
  for (const label of ['无法展示', '部分展示']) {
    expect(screen.getByText(label)).toHaveClass('truncate')
  }
})

it.each(['{Enter}', ' '])(
  'opens the reason with %s and returns focus to the status after Escape',
  async (key) => {
    await renderList([metadata])
    const user = userEvent.setup()
    const trigger = screen.getByRole('button', {
      name: 'Unavailable',
    })
    act(() => trigger.focus())
    await user.keyboard(key)
    expect(
      await screen.findByRole('dialog', { name: 'Unavailable' })
    ).toHaveTextContent('No channel is configured.')
    await user.keyboard('{Escape}')
    await waitFor(() =>
      expect(trigger).toHaveAttribute('aria-expanded', 'false')
    )
    expect(trigger).toHaveFocus()
  }
)

it('opens the warning badge’s own model reason and closes it on an outside click without selecting the row', async () => {
  await renderList([metadata, channel])
  const user = userEvent.setup()
  const triggers = screen.getAllByRole('button', {
    name: 'Unavailable',
  })
  const badge = triggers[1].querySelector('[data-slot="status-badge"]')
  expect(badge).not.toBeNull()
  expect(badge?.querySelector('svg')).toBeNull()
  await user.click(badge as HTMLElement)
  const popup = await screen.findByRole('dialog', { name: 'Unavailable' })
  expect(popup).toHaveTextContent('No channel is currently available.')
  expect(popup).not.toHaveTextContent('No channel is configured.')
  expect(
    screen.getByRole('checkbox', { name: 'Select channel-only' })
  ).not.toBeChecked()
  await user.click(screen.getByPlaceholderText('Filter by model name...'))
  await waitFor(() =>
    expect(
      screen.queryByRole('dialog', { name: 'Unavailable' })
    ).not.toBeInTheDocument()
  )
  expect(triggers[1]).toHaveAttribute('aria-expanded', 'false')
  await user.click(triggers[0])
  expect(
    await screen.findByRole('dialog', { name: 'Unavailable' })
  ).toHaveTextContent('No channel is configured.')
})

it('opens a long translated reason by touch in the mobile card without requiring the detail drawer', async () => {
  const originalMatchMedia = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...originalMatchMedia(query),
    matches: query === '(max-width: 640px)',
  }))
  await renderList([metadata])
  const user = userEvent.setup()
  const trigger = screen.getByRole('button', {
    name: i18n.t('Unavailable'),
  })
  await user.pointer([
    { keys: '[TouchA>]', target: trigger },
    { keys: '[/TouchA]' },
  ])
  const popup = await screen.findByRole('dialog', {
    name: i18n.t('Unavailable'),
  })
  expect(popup).toHaveTextContent(
    i18n.t(
      'No channel is configured. This model will not appear in the model square.'
    )
  )
  expect(popup).toHaveClass('whitespace-normal', 'break-words')
  expect(popup).toHaveClass('max-w-[calc(100vw-2rem)]')
  expect(
    screen.queryByRole('dialog', { name: metadata.model_name })
  ).not.toBeInTheDocument()
})

it.each([
  {
    name: 'legacy',
    effective: { ModelRatio: 1.5, CompletionRatio: 5, CacheRatio: 0.1 },
    catalog: { model_ratio: 1.5, completion_ratio: 5, cache_ratio: 0.1 },
    text: 'Input$3Output$15CacheRead$0.3/1M',
  },
  {
    name: 'single-expression',
    effective: {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': 'tier("base", p * 3 + c * 15 + cr * 0.3)',
    },
    catalog: {
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("base", p * 3 + c * 15 + cr * 0.3)',
    },
    text: 'Input$3Output$15CacheRead$0.3/1M',
  },
  {
    name: 'tier-expression',
    effective: {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr':
        'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", p * 6 + c * 22.5)',
    },
    catalog: {
      billing_mode: 'tiered_expr',
      billing_expr:
        'len <= 200000 ? tier("standard", p * 3 + c * 15) : tier("long", p * 6 + c * 22.5)',
    },
    text: 'Input$3Output$15/1M',
  },
  {
    name: 'free-request',
    effective: { ModelPrice: 0 },
    catalog: { quota_type: 1, model_price: 0 },
    text: 'Per-call$0',
  },
  {
    name: 'free-tokens',
    effective: { ModelRatio: 0, CompletionRatio: 2 },
    catalog: { model_ratio: 0, completion_ratio: 2 },
    text: 'Input$0Output$0/1M',
  },
  {
    name: 'free-expression',
    effective: {
      'billing_setting.billing_mode': 'tiered_expr',
      'billing_setting.billing_expr': 'tier("free", p * 0 + c * 0)',
    },
    catalog: {
      billing_mode: 'tiered_expr',
      billing_expr: 'tier("free", p * 0 + c * 0)',
    },
    text: 'Input$0Output$0/1M',
  },
])(
  'shows $name effective pricing like the catalog without requiring a listed model',
  async ({ name, effective, catalog, text }) => {
    const model = { ...channel, model_name: name }
    await renderList([model], {
      pricing: [{ model_name: name, version: 'v1', configured: {}, effective }],
    })
    const button = screen.getByRole('button', {
      name: `View pricing for ${name}`,
    })
    expect(button.textContent?.replaceAll(/\s/g, '')).toContain(text)
    expect(button).not.toHaveTextContent('Unset price')
    render(
      <CatalogPrice
        model={{
          id: 1,
          model_name: name,
          quota_type: 0,
          model_ratio: 0,
          completion_ratio: 0,
          enable_groups: [],
          ...catalog,
        }}
      />
    )
    // The table is the only surface that spells out the token unit the catalog
    // toolbar owns, so its unit suffix is the whole difference.
    expect(button.textContent?.replace('/ 1M', '')).toBe(
      screen.getByRole('group', { name: 'Catalog price' }).textContent
    )
  }
)

it('opens the effective expression breakdown from the price without creating metadata', async () => {
  const expression =
    '(len <= 200000 ? tier("standard", p * 3 + c * 15 + cr * 0.3) : tier("long", p * 6 + c * 22.5 + cr * 0.6)) * (header("x-priority") == "high" ? 2 : 1)'
  await renderList([channel], {
    pricing: [
      {
        model_name: channel.model_name,
        version: 'v1',
        configured: {},
        effective: {
          'billing_setting.billing_mode': 'tiered_expr',
          'billing_setting.billing_expr': expression,
        },
      },
    ],
  })
  const write = vi.spyOn(api, 'post')
  await userEvent.click(
    screen.getByRole('button', { name: 'View pricing for channel-only' })
  )
  const preview = (await screen.findByText('Tiered price table')).closest(
    'section'
  )
  expect(preview).toHaveTextContent('standard')
  expect(preview).toHaveTextContent('long')
  expect(preview).toHaveTextContent('0.3')
  expect(preview).toHaveTextContent('0.6')
  expect(preview).toHaveTextContent('x-priority')
  expect(write).not.toHaveBeenCalled()
})

it('shows an unrecognized expression as special and retains its full source in pricing details', async () => {
  const expression = 'tier("custom", max(p * 2 + c * 8, 100))'
  await renderList([channel], {
    pricing: [
      {
        model_name: channel.model_name,
        version: 'v1',
        configured: {},
        effective: {
          'billing_setting.billing_mode': 'tiered_expr',
          'billing_setting.billing_expr': expression,
        },
      },
    ],
  })
  const button = screen.getByRole('button', {
    name: 'View pricing for channel-only',
  })
  expect(button).toHaveTextContent('Special billing expression')
  expect(button).not.toHaveTextContent('$2')
  expect(button).not.toHaveTextContent(expression)
  await userEvent.click(button)
  const preview = (await screen.findByText('Raw expression')).closest('section')
  expect(preview).toHaveTextContent(expression)
})

it('distinguishes pending and failed pricing requests from an unset price', async () => {
  let rejectPricing: (reason: Error) => void = () => {}
  const pricing = new Promise<ModelPricingConfig>((_resolve, reject) => {
    rejectPricing = reject
  })
  await renderList([channel], { pricing, waitForPricing: false })
  expect(screen.getByText('Loading...')).toBeVisible()
  expect(screen.queryByText('Unset price')).not.toBeInTheDocument()
  await act(async () => rejectPricing(new Error('pricing unavailable')))
  expect(await screen.findByText('Failed to load model pricing')).toBeVisible()
  expect(screen.queryByText('Unset price')).not.toBeInTheDocument()
})

it('filters actual visibility independently of policy and restores filters through browser history', async () => {
  const { get, router } = await renderList([channel], {
    initialUrl: '/models/metadata?page=3&status=%5B%22enabled%22%5D',
    total: 100,
  })
  const user = userEvent.setup()
  await user.click(
    screen.getByRole('button', { name: 'Model square visibility' })
  )
  await user.click(screen.getByRole('option', { name: 'Partly shown' }))
  await waitFor(() =>
    expect(get).toHaveBeenCalledWith('/api/models/search', {
      params: expect.objectContaining({
        status: 'enabled',
        square_state: 'partial',
        p: 1,
      }),
    })
  )
  expect(router.state.location.search).toMatchObject({
    status: ['enabled'],
    square_state: ['partial'],
  })
  await user.keyboard('{Escape}')
  await act(async () => {
    router.history.back()
  })
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('square_state')
  )
  await act(async () => {
    router.history.forward()
  })
  await waitFor(() =>
    expect(router.state.location.search).toMatchObject({
      square_state: ['partial'],
    })
  )
  await user.click(
    screen.getByRole('button', { name: /Model square visibility/ })
  )
  await user.click(screen.getByRole('option', { name: 'Clear filters' }))
  await waitFor(() =>
    expect(router.state.location.search).not.toHaveProperty('square_state')
  )
  expect(router.state.location.search).toMatchObject({ status: ['enabled'] })
})

it('keeps all columns while collapsing tags and connection counts', async () => {
  await renderList([
    {
      ...channel,
      tags: 'Tools,Files,Vision',
      bound_channels: [{ name: 'Main', type: 1 }],
      enable_groups: ['default', 'premium'],
    },
  ])
  expect(screen.getByText('Channels 1 · Groups 2')).toBeVisible()
  expect(
    screen.getByRole('columnheader', { name: 'Sync policy' })
  ).toBeVisible()
  expect(screen.getByRole('columnheader', { name: 'Tags' })).toBeVisible()
  expect(screen.getByText('Tools')).toBeVisible()
  expect(screen.queryByText('Files')).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Show all tags' }))
  expect(await screen.findByText('Files')).toBeVisible()
  expect(screen.getByText('Vision')).toBeVisible()
})

it('keeps an active visibility filter when its server result is empty', async () => {
  const { get } = await renderList([], {
    initialUrl: '/models/metadata?square_state=%5B%22unavailable%22%5D',
  })
  expect(screen.getByText('No Models Found')).toBeVisible()
  expect(screen.getByText('Try adjusting your search')).toBeVisible()
  expect(
    screen.getByRole('button', { name: /Model square visibility.*Unavailable/ })
  ).toBeVisible()
  expect(get).toHaveBeenCalledWith('/api/models/search', {
    params: expect.objectContaining({ square_state: 'unavailable', p: 1 }),
  })
})

it.each([
  { type: 'CUSTOM' as const, symbol: '🐱' },
  { type: 'TOKENS' as const, symbol: '$' },
])(
  'keeps every price monetary and captions the token unit once in $type mode',
  async ({ type, symbol }) => {
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: type,
        customCurrencySymbol: '🐱',
        customCurrencyExchangeRate: 1,
      },
    })
    await renderList([channel], {
      pricing: [
        {
          model_name: channel.model_name,
          version: 'v1',
          configured: {},
          effective: { ModelRatio: 0.25, CompletionRatio: 2 },
        },
      ],
    })
    const button = screen.getByRole('button', {
      name: 'View pricing for channel-only',
    })
    // The display mode changes the symbol, never the value or its unit: each
    // price carries its own symbol and the unit is stated exactly once.
    expect(button.textContent?.replaceAll(/\s/g, '')).toContain(
      `Input${symbol}0.5Output${symbol}1`
    )
    expect(within(button).getByText('/ 1M')).toBeVisible()
    expect(button.textContent?.match(/1M/g)).toHaveLength(1)
  }
)
