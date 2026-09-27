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
import i18next from 'i18next'
import type React from 'react'
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from 'vitest'

import { useSystemConfigStore } from '@/stores/system-config-store'

import type { LogOtherData } from '../../types'
import { LogCostDisplay } from '../log-cost-display'

function renderCost(
  props: React.ComponentProps<typeof LogCostDisplay>
): ReturnType<typeof render> {
  return render(<LogCostDisplay {...props} />)
}

describe('log cost display', () => {
  beforeAll(() => {
    i18next.addResourceBundle('zhCN', 'translation', {
      'Includes tool-call surcharge': 'Includes tool-call surcharge',
    })
  })

  beforeEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
  })

  afterEach(() => {
    useSystemConfigStore.setState(useSystemConfigStore.getInitialState(), true)
    localStorage.clear()
  })

  test.each([
    { quota: 12500, expected: '$0.025' },
    { quota: 0, expected: '$0' },
    { quota: 1, expected: '$0.000002' },
    { quota: 5000, expected: '$0.01' },
  ])('renders the wallet quota $quota as $expected', ({ quota, expected }) => {
    renderCost({ quota, other: null })

    expect(screen.getByText(expected)).toBeVisible()
  })

  test('keeps the wallet cost on a log whose stored metadata still names a subscription', () => {
    const legacyPayload = {
      billing_source: 'subscription',
      subscription_id: '42',
      subscription_consumed: 12500,
    } as unknown as LogOtherData

    renderCost({ quota: 5000, other: legacyPayload })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.queryByText('$0.025')).not.toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('never renders a funding source marker for wallet logs', () => {
    renderCost({
      quota: 5000,
      other: { billing_source: 'wallet' } as LogOtherData,
    })

    expect(screen.getByText('$0.01')).toBeVisible()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  test('keeps a large amount unabridged in a single-line cost bubble', () => {
    const rendered = renderCost({ quota: 2147483647, other: null })

    const amount = screen.getByText('$4,294.9673')
    expect(amount).toBeVisible()
    expect(amount).toHaveClass('whitespace-nowrap')
    expect(amount.closest('[data-slot="status-badge"]')).toHaveClass(
      'border',
      'rounded-md',
      'tabular-nums'
    )
    expect(rendered.container.firstElementChild).toHaveClass('inline-flex')
    expect(rendered.container.firstElementChild).not.toHaveClass('flex-col')
  })

  test('keeps the regular cost visible and adds an accessible surcharge marker', () => {
    renderCost({
      quota: 12500,
      other: {
        tool_surcharges: [{ name: 'lookup_customer', count: 1, price: 5 }],
      },
    })

    expect(screen.getByText('$0.025')).toBeVisible()
    const marker = screen.getByRole('img', {
      name: 'Includes tool-call surcharge',
    })
    expect(marker).toHaveAttribute('data-tool-surcharge-indicator', 'true')
    expect(marker).toHaveAttribute('tabindex', '0')
  })
})
