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
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { FlowUserFilterOption } from '@/features/dashboard/types'

import { FlowUserFilterControl } from '../flow-user-filter'

const mockOptions: FlowUserFilterOption[] = [
  {
    value: 'user-1',
    label: 'alice',
    valueLabel: '$150.00',
    valueRaw: 150000000,
    color: '#3b82f6',
  },
  {
    value: 'user-2',
    label: 'bob',
    valueLabel: '$80.00',
    valueRaw: 80000000,
    color: '#10b981',
  },
]

describe('FlowUserFilterControl', () => {
  it('renders unselected trigger state with "All users"', () => {
    render(
      <FlowUserFilterControl
        metricLabel='Quota'
        formatMetricValue={(v) => `$${(v / 1000000).toFixed(2)}`}
        options={mockOptions}
        selectedUsers={[]}
        onToggleUser={vi.fn()}
        onRemoveUser={vi.fn()}
        onClearUsers={vi.fn()}
      />
    )

    expect(screen.getByText('User filters')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Filter by user' })
    ).toHaveTextContent('All users')
  })

  it('opens popover on click and toggles user on item select', async () => {
    const user = userEvent.setup()
    const onToggleUser = vi.fn()

    render(
      <FlowUserFilterControl
        metricLabel='Quota'
        formatMetricValue={(v) => `$${(v / 1000000).toFixed(2)}`}
        options={mockOptions}
        selectedUsers={[]}
        onToggleUser={onToggleUser}
        onRemoveUser={vi.fn()}
        onClearUsers={vi.fn()}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Filter by user' })
    await user.click(trigger)

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Filter by user')).toBeInTheDocument()
    })

    const aliceItem = screen.getByText('alice')
    await user.click(aliceItem)

    expect(onToggleUser).toHaveBeenCalledWith('user-1')
  })

  it('renders selected users count, chips with remove buttons, and clear action', async () => {
    const user = userEvent.setup()
    const onRemoveUser = vi.fn()
    const onClearUsers = vi.fn()

    render(
      <FlowUserFilterControl
        metricLabel='Quota'
        formatMetricValue={(v) => `$${(v / 1000000).toFixed(2)}`}
        options={mockOptions}
        selectedUsers={['user-1', 'user-2']}
        onToggleUser={vi.fn()}
        onRemoveUser={onRemoveUser}
        onClearUsers={onClearUsers}
      />
    )

    const trigger = screen.getByRole('button', { name: 'Filter by user' })
    expect(trigger).toHaveTextContent('Selected users')
    expect(trigger).toHaveTextContent('2')

    // Chips for each selected user
    expect(screen.getByText('alice')).toBeInTheDocument()
    expect(screen.getByText('bob')).toBeInTheDocument()

    // Remove single chip
    const removeButtons = screen.getAllByRole('button', {
      name: 'Remove user filter',
    })
    expect(removeButtons).toHaveLength(2)
    await user.click(removeButtons[0])
    expect(onRemoveUser).toHaveBeenCalledWith('user-1')

    // Clear all button (visible when > 1 selected)
    const clearBtn = screen.getByRole('button', { name: 'Clear' })
    await user.click(clearBtn)
    expect(onClearUsers).toHaveBeenCalled()
  })
})
