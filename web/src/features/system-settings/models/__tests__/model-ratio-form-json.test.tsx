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

  it('keeps the toolbar in one row and lets the switch label give way', async () => {
    render(<Harness />)
    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to JSON' })
    )

    // 三个控件（保存、暴露倍率接口、模式切换）在页头那一行里共用一条行：
    // 窄屏下让步的是标签文字，不能把某个控件挤到下一行去（那会在页头里多出一
    // 行，正是这一项要修掉的观感）。jsdom 不做布局，所以钉的是让浏览器这样排的
    // 契约：一个不换行的 flex 行，且标签那一格带 `min-w-0` 与截断用的 span。
    const save = screen.getByRole('button', { name: 'Save model prices' })
    const row = save.parentElement as HTMLElement
    expect(row.className.split(/\s+/)).toContain('flex-nowrap')
    expect(row.className.split(/\s+/)).toContain('min-w-0')
    expect(row.className.split(/\s+/)).not.toContain('flex-wrap')
    expect((save.nextElementSibling as HTMLElement).tagName.toLowerCase()).toBe(
      'div'
    )

    const label = screen.getByText('Expose ratio API')
    expect(label.className.split(/\s+/)).toContain('truncate')
    expect(label.parentElement?.className.split(/\s+/)).toContain('min-w-0')
  })

  it('renders the save button beside the switch and mode buttons, not on its own row', async () => {
    render(<Harness />)

    // 视觉模式下没有保存按钮；切到 JSON 后它出现在同一个容器里，顺序是保存、
    // 开关、模式切换 —— 不能像以前那样独占一行（那一版是容器外的第二个子元素）。
    expect(
      screen.queryByRole('button', { name: 'Save model prices' })
    ).toBeNull()

    await userEvent.click(
      screen.getByRole('button', { name: 'Switch to JSON' })
    )

    const form = document.querySelector('form') as HTMLElement
    const save = screen.getByRole('button', { name: 'Save model prices' })
    // 保存按钮不在 JSON 表单里，而在页头那一行（测试里 `fallbackInline` 把它
    // 放在同一行内）。
    expect(form).not.toContainElement(save)
    const row = save.parentElement as HTMLElement
    expect(row).toBe(
      screen.getByRole('button', { name: 'Switch to Visual' }).parentElement
    )
  })
})
