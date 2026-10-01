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
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { tryParseVisualConfig } from '@/features/pricing/lib/tier-expr'
import {
  ModelPricingEditorPanel,
  type ModelPricingEditorPanelHandle,
  type ModelRatioData,
} from '@/features/system-settings/models/model-pricing-sheet'
import { api } from '@/lib/api'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'
import {
  DEFAULT_CURRENCY_CONFIG,
  useSystemConfigStore,
} from '@/stores/system-config-store'


const clients: QueryClient[] = []

beforeEach(() => {
  localStorage.clear()
  usePricingPreferencesStore.setState({ currency: 'USD' })
  useSystemConfigStore.getState().setConfig({
    currency: {
      ...DEFAULT_CURRENCY_CONFIG,
      quotaDisplayType: 'CNY',
      usdExchangeRate: 7,
    },
  })
  vi.spyOn(api, 'get').mockResolvedValue({
    data: { success: true, data: [], vendors: [] },
  })
})

afterEach(() => {
  cleanup()
  clients.splice(0).forEach((client) => client.clear())
  usePricingPreferencesStore.setState({ currency: 'USD' })
  useSystemConfigStore
    .getState()
    .setConfig({ currency: { ...DEFAULT_CURRENCY_CONFIG } })
  localStorage.clear()
})

function renderEditor(data: Partial<ModelRatioData> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  client.setQueryData(['status'], null)
  clients.push(client)
  const ref = createRef<ModelPricingEditorPanelHandle>()
  const dirty = vi.fn()
  const view = (entry: Partial<ModelRatioData>) => (
    <QueryClientProvider client={client}>
      <ModelPricingEditorPanel
        ref={ref}
        editData={{
          name: 'currency-model',
          billingMode: 'per-token',
          ratio: '1',
          completionRatio: '2',
          ...entry,
        }}
        onDirtyChange={dirty}
      />
    </QueryClientProvider>
  )
  const result = render(view(data))
  return {
    ...result,
    ref,
    dirty,
    reload: (entry: Partial<ModelRatioData>) => result.rerender(view(entry)),
  }
}

async function selectCurrency(label: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole('combobox', { name: 'Pricing currency' }))
  await user.click(await screen.findByRole('option', { name: label }))
}

async function commit(
  ref: React.RefObject<ModelPricingEditorPanelHandle | null>
) {
  let result: ModelRatioData | null = null
  await act(async () => {
    result = (await ref.current?.commitDraft()) ?? null
  })
  return result as ModelRatioData | null
}

it('opens the billing expression editor without legacy pricing tabs', () => {
  const editor = renderEditor({
    ratio: '',
    completionRatio: '',
    billingMode: 'tiered_expr',
    billingExpr: '',
  })
  expect(
    screen.getByRole('complementary', { name: 'Billing expression (USD)' })
  ).toBeVisible()
  expect(screen.queryByRole('tab')).not.toBeInTheDocument()
  expect(editor.dirty).toHaveBeenLastCalledWith(false)
})

it('defaults to USD, remembers a currency choice and restores it when reopened', async () => {
  const editor = renderEditor()
  expect(
    screen.getByRole('combobox', { name: 'Pricing currency' })
  ).toHaveTextContent('US dollar (USD)')
  await selectCurrency('Site currency (CNY)')
  expect(
    screen.getByRole('combobox', { name: 'Pricing currency' })
  ).toHaveTextContent('Site currency (CNY)')
  editor.unmount()
  // Rehydrate from browser storage, rather than relying on the live store.
  const stored = localStorage.getItem('model-pricing-preferences') ?? ''
  expect(stored).not.toBe('')
  usePricingPreferencesStore.setState({ currency: 'USD' })
  localStorage.setItem('model-pricing-preferences', stored)
  await usePricingPreferencesStore.persist.rehydrate()
  renderEditor()
  expect(
    screen.getByRole('combobox', { name: 'Pricing currency' })
  ).toHaveTextContent('Site currency (CNY)')
})

it('opens currency help by keyboard and restores focus after Escape', async () => {
  renderEditor()
  const user = userEvent.setup()
  const help = screen.getByRole('button', { name: 'About pricing currency' })
  help.focus()
  await user.keyboard('{Enter}')
  const dialog = await screen.findByRole('dialog', {
    name: 'About pricing currency',
  })
  expect(
    within(dialog).getByText(/The system always bills in USD/)
  ).toBeVisible()
  expect(
    within(dialog).getByText('Current exchange rate: 1 USD = 7 CNY')
  ).toBeVisible()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(help).toHaveFocus())
})

it('switches currencies and refreshes exchange rates without changing stored prices or dirty state', async () => {
  const editor = renderEditor({ ratio: '0.123456789123', cacheRatio: '0' })
  const before = await commit(editor.ref)
  editor.dirty.mockClear()
  await selectCurrency('Site currency (CNY)')
  await selectCurrency('US dollar (USD)')
  await selectCurrency('Site currency (CNY)')
  act(() =>
    useSystemConfigStore.getState().setConfig({
      currency: {
        ...DEFAULT_CURRENCY_CONFIG,
        quotaDisplayType: 'CNY',
        usdExchangeRate: 3,
      },
    })
  )
  expect(await commit(editor.ref)).toEqual(before)
  expect(editor.dirty).not.toHaveBeenCalledWith(true)
})

it('converts tier price coefficients but leaves token thresholds and rule multipliers unchanged', async () => {
  const expr =
    'len <= 200000 ? tier("short", p * 2 + c * 4) : tier("long", p * 4 + c * 8)'
  const editor = renderEditor({
    billingMode: 'tiered_expr',
    billingExpr: expr,
    requestRuleExpr: '(header("x-priority") == "high" ? 2 : 1)',
  })
  const before = await commit(editor.ref)
  await selectCurrency('Site currency (CNY)')
  expect(await commit(editor.ref)).toEqual(before)
  const inputs = screen.getAllByRole('textbox', { name: 'Input price' })
  expect(inputs[0]).toHaveValue('14')
  fireEvent.change(inputs[0], { target: { value: '21' } })
  const saved = await commit(editor.ref)
  const config = tryParseVisualConfig(saved?.billingExpr ?? '')
  expect(config?.tiers[0].input_unit_cost).toBe(3)
  expect(config?.tiers[0].conditions).toEqual([
    { var: 'len', op: '<=', value: 200000 },
  ])
  expect(saved?.requestRuleExpr).toBe(before?.requestRuleExpr)
})

it('keeps custom raw expressions byte-for-byte intact on currency changes', async () => {
  const expr = 'tier("custom", max(p * 2, 100))'
  const editor = renderEditor({
    billingMode: 'tiered_expr',
    billingExpr: expr,
  })
  await selectCurrency('Site currency (CNY)')
  expect(await commit(editor.ref)).toMatchObject({ billingExpr: expr })
  expect(
    screen.getByText(
      'Raw expressions and presets use USD. Currency selection only converts visual price inputs and monetary previews.'
    )
  ).toBeVisible()
})

it('switches currency without changing time pricing or request rules', async () => {
  const expression =
    'hour("Asia/Shanghai") < 12 ? tier("peak", p * 3 + c * 9) : tier("off_peak", p * 1.5 + c * 4.5)'
  const rules = '(header("tier") == "fast" ? 2 : 1)'
  const editor = renderEditor({
    billingMode: 'tiered_expr',
    billingExpr: expression,
    requestRuleExpr: rules,
  })
  const before = await commit(editor.ref)
  await selectCurrency('Site currency (CNY)')
  expect(await commit(editor.ref)).toEqual(before)
  expect(before?.billingExpr).toBe(expression)
  expect(before?.requestRuleExpr).toBe(rules)
})

it('switches currency using the keyboard without changing the saved configuration', async () => {
  const editor = renderEditor()
  const original = await commit(editor.ref)
  const user = userEvent.setup()
  screen.getByRole('combobox', { name: 'Pricing currency' }).focus()
  await user.keyboard('{ArrowDown}{End}{Enter}')
  expect(
    screen.getByRole('combobox', { name: 'Pricing currency' })
  ).toHaveTextContent('Site currency (CNY)')
  expect(await commit(editor.ref)).toEqual(original)
})

it('preserves time billing on direct save and blocks incomplete local conditions', async () => {
  const expression =
    'hour("Asia/Shanghai") >= 9 ? tier("peak", p * 3 + cr * 0 + c * 9) : tier("off", p * 1 + c * 2)'
  const requestRuleExpr = '(header("x-plan") == "fast" ? 2.00 : 1)'
  const editor = renderEditor({
    billingMode: 'tiered_expr',
    billingExpr: expression,
    requestRuleExpr,
  })
  expect(await commit(editor.ref)).toMatchObject({
    billingExpr: expression,
    requestRuleExpr,
  })
  await selectCurrency('Site currency (CNY)')
  expect(await commit(editor.ref)).toMatchObject({
    billingExpr: expression,
    requestRuleExpr,
  })
  fireEvent.change(screen.getByRole('textbox', { name: 'Condition value' }), {
    target: { value: '' },
  })
  expect(await commit(editor.ref)).toBeNull()
  fireEvent.change(screen.getByRole('textbox', { name: 'Condition value' }), {
    target: { value: '10' },
  })
  expect(await commit(editor.ref)).toMatchObject({
    billingExpr: expression.replace('>= 9', '>= 10'),
    requestRuleExpr,
  })
})
