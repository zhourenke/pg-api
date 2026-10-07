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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'

import { ModelRatioVisualEditor } from '../model-ratio-visual-editor'

let client: QueryClient | undefined

afterEach(() => {
  client?.clear()
  localStorage.clear()
  vi.restoreAllMocks()
})

// 窄屏分支由两个媒体查询决定（列表换成卡片、编辑器换成抽屉），所以把所有查询
// 都置为命中，与真实手机上打开这一页等价。
function mockNarrowViewport() {
  const original = window.matchMedia
  return vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: true,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }))
}

async function renderNarrowEditor(options?: {
  filterMode?: 'all' | 'unset'
  candidateModelNames?: string[]
  modelRatio?: string
}) {
  vi.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/pricing') {
      return { data: { success: true, data: [], vendors: [] } }
    }
    return { data: { success: true, data: {} } }
  })
  // 已保存的与草稿里的定价一致，行才不会被当成「在草稿里删掉了」而消失。
  const modelRatio = options?.modelRatio ?? '{"claude-sonnet": 1.5}'
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client = queryClient
  render(
    <QueryClientProvider client={client}>
      <ModelRatioVisualEditor
        savedModelPrice='{}'
        savedModelRatio={modelRatio}
        savedCacheRatio='{}'
        savedCreateCacheRatio='{}'
        savedCompletionRatio='{}'
        savedImageRatio='{}'
        savedAudioRatio='{}'
        savedAudioCompletionRatio='{}'
        savedBillingMode='{}'
        savedBillingExpr='{}'
        modelPrice='{}'
        modelRatio={modelRatio}
        cacheRatio='{}'
        createCacheRatio='{}'
        completionRatio='{}'
        imageRatio='{}'
        audioRatio='{}'
        audioCompletionRatio='{}'
        billingMode='{}'
        billingExpr='{}'
        candidateModelNames={options?.candidateModelNames}
        filterMode={options?.filterMode}
        onChange={vi.fn()}
        onPersist={vi.fn(async () => {})}
        onSave={vi.fn()}
        isSaving={false}
      />
    </QueryClientProvider>
  )
  // 真实页面上定价元数据早就加载完了，用户点卡片时不该还在等它。
  await waitFor(() => expect(queryClient.isFetching()).toBe(0))
}

function cardFor(model: string) {
  const card = screen
    .getByText(model)
    .closest<HTMLElement>('[data-slot="model-ratio-card"]')
  if (!card) throw new Error(`no card for ${model}`)
  return card
}

it('opens the pricing drawer when the card body is tapped', async () => {
  mockNarrowViewport()
  await renderNarrowEditor()
  await screen.findByText('claude-sonnet')

  fireEvent.click(screen.getByText('claude-sonnet'))

  const sheet = await screen.findByRole('dialog', {
    name: 'Edit model pricing',
  })
  expect(
    within(sheet).getByRole('textbox', { name: 'Model name' })
  ).toHaveValue('claude-sonnet')
})

it('leaves a tap on the card delete action to the confirmation alone', async () => {
  mockNarrowViewport()
  await renderNarrowEditor()
  await screen.findByText('claude-sonnet')

  fireEvent.click(
    within(cardFor('claude-sonnet')).getByRole('button', { name: 'Delete' })
  )

  expect(await screen.findByRole('alertdialog')).toBeInTheDocument()
  expect(
    screen.queryByRole('dialog', { name: 'Edit model pricing' })
  ).toBeNull()
})

it('opens the drawer for a model that has no price yet', async () => {
  mockNarrowViewport()
  await renderNarrowEditor({
    filterMode: 'unset',
    candidateModelNames: ['claude-unset-demo'],
    modelRatio: '{}',
  })
  await screen.findByText('claude-unset-demo')

  // 这一支只有「点开某一行的编辑」一个入口：宽屏点整行，窄屏就该点卡片。
  fireEvent.click(screen.getByText('claude-unset-demo'))

  const sheet = await screen.findByRole('dialog', {
    name: 'Edit model pricing',
  })
  expect(
    within(sheet).getByRole('textbox', { name: 'Model name' })
  ).toHaveValue('claude-unset-demo')
})
