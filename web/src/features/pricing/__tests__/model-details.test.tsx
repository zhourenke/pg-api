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
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ModelDetailsContent } from '../components/model-details'
import type { PricingModel } from '../types'

vi.mock('../components/model-overview-trend', () => ({
  ModelOverviewTrend: () => null,
}))
vi.mock('../components/model-details-api', () => ({
  ModelDetailsApi: () => null,
}))

function detailsModel(overrides: Partial<PricingModel> = {}): PricingModel {
  return {
    id: 1,
    model_name: 'deepseek-v4.1-flash',
    vendor_name: 'DeepSeek',
    quota_type: 0,
    model_ratio: 1,
    completion_ratio: 4,
    enable_groups: ['default'],
    supported_endpoint_types: ['openai'],
    tags: 'chat',
    group_ratio: { default: 1 },
    billing_mode: 'tiered_expr',
    billing_expr: 'tier("standard", p * 0.05 + c * 0.2)',
    ...overrides,
  }
}

function renderDetails(
  model: PricingModel,
  usableGroup: Record<string, { desc: string; ratio: number }> = {}
) {
  return render(
    <ModelDetailsContent
      model={model}
      groupRatio={{}}
      usableGroup={usableGroup}
      endpointMap={{}}
      autoGroups={[]}
      priceRate={1}
      usdExchangeRate={1}
      tokenUnit='M'
    />
  )
}

describe('model details content', () => {
  it('keeps only groups, endpoints and tags in the model section', () => {
    renderDetails(detailsModel())

    const section = screen
      .getByRole('heading', { name: 'Model' })
      .closest('section') as HTMLElement
    expect(within(section).queryByText('Provider')).toBeNull()
    expect(within(section).queryByText('Type')).toBeNull()
    expect(within(section).getByText('Groups')).toBeVisible()
    expect(within(section).getByText('Endpoints')).toBeVisible()
    expect(within(section).getByText('Tags')).toBeVisible()
  })

  it('does not repeat the vendor and billing mode above the tabs', () => {
    renderDetails(detailsModel())

    const header = screen.getByRole('banner')
    expect(within(header).getByText('deepseek-v4.1-flash')).toBeVisible()
    expect(within(header).queryByText('DeepSeek')).toBeNull()
    expect(within(header).queryByText('Dynamic Pricing')).toBeNull()
  })

  it('heads the per-call column of group pricing with the billed unit only', () => {
    renderDetails(detailsModel({ billing_expr: 'tier("base", fixed(0.02))' }), {
      default: { desc: '', ratio: 1 },
    })

    const groupPricing = screen
      .getByRole('heading', { name: 'Pricing by Group' })
      .closest('section') as HTMLElement
    expect(
      within(groupPricing).getByRole('columnheader', { name: 'Per-call' })
    ).toBeVisible()
    for (const header of within(groupPricing).getAllByRole('columnheader')) {
      expect(header.textContent).not.toMatch(/\/\s*(request|image)/)
    }
  })

  it('heads the image column of group pricing with the billed unit only', () => {
    renderDetails(
      detailsModel({
        billing_expr: 'tier("image", fixed(0.04)) * image_count',
      }),
      { default: { desc: '', ratio: 1 } }
    )

    const groupPricing = screen
      .getByRole('heading', { name: 'Pricing by Group' })
      .closest('section') as HTMLElement
    expect(
      within(groupPricing).getByRole('columnheader', { name: 'Per image' })
    ).toBeVisible()
    for (const header of within(groupPricing).getAllByRole('columnheader')) {
      expect(header.textContent).not.toMatch(/\/\s*(request|image)/)
    }
  })
})
