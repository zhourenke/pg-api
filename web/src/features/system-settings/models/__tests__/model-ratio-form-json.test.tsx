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
import userEvent from '@testing-library/user-event'
import { useForm } from 'react-hook-form'
import { describe, expect, it, vi } from 'vitest'

import { ModelRatioForm, type ModelFormValues } from '../model-ratio-form'

// 多行表达式：JSON 字符串里的换行必须在编辑框里原样可见、可保存。
const expression =
  'len <= 32000\n  ? tier("short", p * 2)\n  : tier("long", p * 3)'

const values: ModelFormValues = {
  ModelPrice: '{}',
  ModelRatio: '{"gpt":"0.5"}',
  CacheRatio: '{}',
  CreateCacheRatio: '{}',
  CompletionRatio: '{}',
  ImageRatio: '{}',
  AudioRatio: '{}',
  AudioCompletionRatio: '{}',
  ExposeRatioEnabled: false,
  BillingMode: '{"gpt":"tiered_expr"}',
  BillingExpr: JSON.stringify({ gpt: expression }),
}

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
})

function Harness() {
  const form = useForm<ModelFormValues>({ defaultValues: values })

  return (
    <QueryClientProvider client={queryClient}>
      <ModelRatioForm
        form={form}
        savedValues={values}
        onSave={vi.fn()}
        onPersist={vi.fn()}
        isSaving={false}
      />
    </QueryClientProvider>
  )
}

describe('model ratio JSON mode', () => {
  it('lists the billing mode and expression so tiered pricing stays editable', async () => {
    render(<Harness />)

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to JSON' })
    )

    // 阶梯定价在 JSON 模式里必须可见：模式与表达式各有一个编辑框。
    expect(screen.getByText('Billing mode')).toBeVisible()
    expect(screen.getByText('Billing expression')).toBeVisible()

    const typedEditors = screen
      .getAllByRole('textbox')
      .filter((node) => (node as HTMLTextAreaElement).value.includes('tier('))
    expect(typedEditors).toHaveLength(1)

    // 表达式原样（含换行）出现在编辑框里，保存时不会丢内容。
    const shown = JSON.parse(
      (typedEditors[0] as HTMLTextAreaElement).value
    ) as Record<string, string>
    expect(shown.gpt).toBe(expression)
  })
})
