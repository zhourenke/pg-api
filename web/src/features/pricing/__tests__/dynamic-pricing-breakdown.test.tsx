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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { DynamicPricingBreakdown } from '../components/dynamic-pricing-breakdown'

describe('dynamic pricing breakdown', () => {
  it('heads a per-call tier table with the billed unit and no request suffix', () => {
    render(<DynamicPricingBreakdown billingExpr='tier("base", fixed(0.02))' />)

    expect(screen.getByRole('columnheader', { name: 'Per-call' })).toBeVisible()
    const row = screen.getByRole('row', { name: /base/ })
    expect(row).toHaveTextContent('$0.02')
    expect(row.textContent).not.toMatch(/\/\s*request/)
  })

  it('heads an image-billed tier table with the billed unit and no image suffix', () => {
    render(
      <DynamicPricingBreakdown billingExpr='tier("image", fixed(0.04)) * image_count' />
    )

    expect(
      screen.getByRole('columnheader', { name: 'Per image' })
    ).toBeVisible()
    const row = screen.getByRole('row', { name: /^image/ })
    expect(row).toHaveTextContent('$0.04')
    expect(row.textContent).not.toMatch(/\/\s*image/)
  })

  it('orders column headers as Input -> Image In -> Image Out -> Cache Read -> Image Cache for image models', () => {
    render(
      <DynamicPricingBreakdown billingExpr='tier("base", p * 0.714285714286 + img_cr * 0.285714285714 + img * 1.142857142857 + img_o * 4.285714285714 + cr * 0.178571428571)' />
    )

    const headers = screen
      .getAllByRole('columnheader')
      .map((th) => th.textContent?.trim())

    // 表头包含：Tier 以及按照【输入 → 图像输入 → 图像输出 → 缓存读取 → 图片缓存】排列的列
    expect(headers).toEqual([
      'Tier',
      'Input',
      'Image In',
      'Image Out',
      'Cache Read',
      'Image Cache',
    ])
  })
})
