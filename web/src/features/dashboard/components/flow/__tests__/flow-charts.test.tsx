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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FlowQuotaDataItem } from '@/features/dashboard/types'
import { ROLE } from '@/lib/roles'
import { useAuthStore } from '@/stores/auth-store'

import { FlowCharts } from '../flow-charts'

let mountCount = 0
let unmountCount = 0

const fakeChart = vi.hoisted(() => ({
  hideTooltip: vi.fn(),
  clearState: vi.fn(),
}))

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: { onReady?: (instance: unknown) => void }) => {
    useEffect(() => {
      mountCount++
      return () => {
        unmountCount++
      }
    }, [])
    useEffect(() => {
      props.onReady?.(fakeChart)
    }, [props])
    return <div data-testid='vchart-sankey-mock' />
  },
}))

vi.mock('@visactor/vchart', () => ({
  ThemeManager: { setCurrentTheme: vi.fn() },
}))

const mockFlowRows: FlowQuotaDataItem[] = [
  {
    user_id: 1,
    username: 'alice',
    node_name: 'node-1',
    token_id: 10,
    token_name: 'key-1',
    use_group: 'default',
    channel_id: 100,
    channel_name: 'OpenAI',
    model_name: 'gpt-4o',
    token_used: 1500,
    count: 10,
    quota: 50000,
  },
  {
    user_id: 2,
    username: 'bob',
    node_name: 'node-1',
    token_id: 20,
    token_name: 'key-2',
    use_group: 'default',
    channel_id: 101,
    channel_name: 'Claude',
    model_name: 'claude-3-5-sonnet',
    token_used: 2500,
    count: 15,
    quota: 80000,
  },
]

vi.mock('@/features/dashboard/api', () => ({
  getFlowQuotaDates: vi.fn(async () => ({
    success: true,
    data: mockFlowRows,
  })),
}))

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
  }
}

describe('FlowCharts time filter preset updates', () => {
  beforeEach(() => {
    mountCount = 0
    unmountCount = 0
    useAuthStore.setState({
      auth: {
        ...useAuthStore.getState().auth,
        user: {
          id: 1,
          username: 'admin',
          role: ROLE.ADMIN,
          status: 1,
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('remounts VChart when switching between time presets with identical row counts', async () => {
    const Wrapper = createWrapper()
    const { rerender } = render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )

    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    expect(mountCount).toBe(1)

    // Switch to another preset ('7d') which returns the same 2 rows
    rerender(
      <Wrapper>
        <FlowCharts filters={{ preset: '7d' }} />
      </Wrapper>
    )

    // With proper keying on the time window, VChart must remount to guarantee re-layout of the Sankey
    await waitFor(() => {
      expect(mountCount).toBe(2)
      expect(unmountCount).toBe(1)
    })
  })

  it('closes the Sankey tooltip on a mouse leave or a press outside it', async () => {
    // `triggerOff: 'none'` (see buildFlowSankeySpec) keeps the mark tooltip open
    // while a finger scrubs across gaps in the flow, so the component has to
    // re-create the dismissal VChart no longer performs.
    fakeChart.hideTooltip.mockClear()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const host = screen.getByTestId('vchart-sankey-mock').parentElement
    if (!host) throw new Error('expected the chart host element')

    // A mouse leaving the chart closes it.
    fireEvent.pointerLeave(host, { pointerType: 'mouse' })
    expect(fakeChart.hideTooltip).toHaveBeenCalledTimes(1)

    // A touch's pointerleave (the raised finger) must not, or it would undo the
    // hold that keeps the tapped value on screen.
    fireEvent.pointerLeave(host, { pointerType: 'touch' })
    expect(fakeChart.hideTooltip).toHaveBeenCalledTimes(1)

    // A press anywhere outside the chart closes it too.
    fireEvent.pointerDown(document.body, { pointerType: 'mouse' })
    expect(fakeChart.hideTooltip).toHaveBeenCalledTimes(2)
  })
})
