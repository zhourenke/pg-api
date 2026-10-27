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
  clearHovered: vi.fn(),
}))

type ChartMockProps = {
  onReady?: (instance: unknown) => void
  onPointerDown?: (event: unknown) => void
  onPointerMove?: (event: unknown) => void
  onPointerUp?: (event: unknown) => void
  data?: unknown
}

const chartProps = vi.hoisted(() => ({
  current: null as ChartMockProps | null,
}))

vi.mock('@visactor/react-vchart', () => ({
  VChart: (props: ChartMockProps) => {
    chartProps.current = props
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

// Reads the highlight flags the component hands to the chart as its `data`
// prop, so a test can assert the user-visible selection rather than an
// internal state update.
function highlightedNodeKeys(): string[] {
  const data = chartProps.current?.data as
    | Array<{
        values?: Array<{
          nodes?: Array<{ key: string; highlighted?: boolean }>
        }>
      }>
    | undefined
  const nodes = data?.[0]?.values?.[0]?.nodes ?? []
  return nodes.filter((node) => node.highlighted).map((node) => node.key)
}

function chartEvent(pointerType: string, datum?: unknown) {
  return { event: { pointerType }, datum }
}

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

  it('selects on touch lift, not on touch press, and drops the drag hover', async () => {
    // A finger cannot hover, so the selection is committed when it lifts - at
    // the point it left - rather than on press. That is what stops a swipe from
    // leaving the highlight stuck on the node it merely passed over, and it
    // makes a tap and a swipe-ending-on-a-node resolve to that node.
    fakeChart.clearHovered.mockClear()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    // Pressing a node with a finger must not select it yet.
    act(() => {
      props.onPointerDown?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    expect(highlightedNodeKeys()).not.toContain('token:10')
    expect(fakeChart.clearHovered).not.toHaveBeenCalled()

    // Lifting on it commits the selection and drops the transient hover.
    act(() => {
      props.onPointerUp?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    expect(fakeChart.clearHovered).toHaveBeenCalledTimes(1)
    expect(highlightedNodeKeys()).toContain('token:10')
  })

  it('keeps selecting on mouse press and leaves the hover alone on a mouse lift', async () => {
    fakeChart.clearHovered.mockClear()
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    act(() => {
      props.onPointerDown?.(
        chartEvent('mouse', { key: 'token:10', kind: 'token' })
      )
    })
    expect(highlightedNodeKeys()).toContain('token:10')

    act(() => {
      props.onPointerUp?.(
        chartEvent('mouse', { key: 'token:10', kind: 'token' })
      )
    })
    expect(fakeChart.clearHovered).not.toHaveBeenCalled()
  })

  it('keeps the highlight on the node a swipe started from when the finger lifts in a gap', async () => {
    // A fingertip is far wider than a Sankey node and routinely lifts over a
    // link or empty space; committing only the lift point's mark would drop the
    // highlight on release. The datum pressed at the start must survive.
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    act(() => {
      props.onPointerDown?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    // The finger slides into a gap; the move reports no mark.
    act(() => {
      props.onPointerMove?.(chartEvent('touch'))
    })
    act(() => {
      props.onPointerUp?.(chartEvent('touch'))
    })

    expect(highlightedNodeKeys()).toContain('token:10')
  })

  it('commits the last node the finger passed over when it lifts in a gap', async () => {
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    act(() => {
      props.onPointerDown?.(chartEvent('touch'))
    })
    act(() => {
      props.onPointerMove?.(
        chartEvent('touch', { key: 'token:20', kind: 'token' })
      )
    })
    act(() => {
      props.onPointerMove?.(chartEvent('touch'))
    })
    act(() => {
      props.onPointerUp?.(chartEvent('touch'))
    })

    expect(highlightedNodeKeys()).toContain('token:20')
  })

  it('does not reuse a previous gesture datum for a later tap on empty space', async () => {
    const Wrapper = createWrapper()
    render(
      <Wrapper>
        <FlowCharts filters={{ preset: '24h' }} />
      </Wrapper>
    )
    await waitFor(() => {
      expect(screen.getByTestId('vchart-sankey-mock')).toBeInTheDocument()
    })
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    // First gesture selects a node.
    act(() => {
      props.onPointerDown?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    act(() => {
      props.onPointerUp?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    expect(highlightedNodeKeys()).toContain('token:10')

    // A fresh press on empty space starts a new gesture with no datum, so the
    // lift clears rather than re-selecting the earlier node.
    act(() => {
      props.onPointerDown?.(chartEvent('touch'))
    })
    act(() => {
      props.onPointerUp?.(chartEvent('touch'))
    })
    expect(highlightedNodeKeys()).not.toContain('token:10')
  })

  it('clears the selection when a touch lifts on empty space', async () => {
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
    const props = chartProps.current
    if (!props) throw new Error('expected the chart props')

    act(() => {
      props.onPointerUp?.(
        chartEvent('touch', { key: 'token:10', kind: 'token' })
      )
    })
    expect(highlightedNodeKeys()).toContain('token:10')

    act(() => {
      props.onPointerUp?.(chartEvent('touch'))
    })
    expect(highlightedNodeKeys()).not.toContain('token:10')
    expect(fakeChart.hideTooltip).toHaveBeenCalled()
  })
})
