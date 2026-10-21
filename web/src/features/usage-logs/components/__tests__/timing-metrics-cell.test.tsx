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
import { fireEvent, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { act } from 'react'
import { describe, expect, test } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'

import { StreamTpsCell, TimingMetricsCell } from '../timing-metrics-cell'

describe('TimingMetricsCell', () => {
  test('renders duration and first token time for stream requests', () => {
    render(
      <TimingMetricsCell
        durationMs={5400}
        frtMs={1200}
        completionTokens={150}
        isStream
      />
    )

    expect(screen.getByText('First token')).toBeInTheDocument()
    expect(screen.getByText('1.2 s')).toBeInTheDocument()
    expect(screen.getByText('Generate')).toBeInTheDocument()
    expect(screen.getByText('4.2 s')).toBeInTheDocument()
  })

  test('omits first token time for non-stream requests', () => {
    render(
      <TimingMetricsCell
        durationMs={3000}
        completionTokens={100}
        isStream={false}
      />
    )

    expect(screen.queryByText('First token')).not.toBeInTheDocument()
    expect(screen.getByText('Generate')).toBeInTheDocument()
    expect(screen.getByText('3.0 s')).toBeInTheDocument()
  })

  test('keeps timing values shrinkable and truncated with hover title', () => {
    const { container } = render(
      <TimingMetricsCell
        durationMs={5400}
        frtMs={1200}
        completionTokens={150}
        isStream
      />
    )

    const firstTokenVal = screen.getByText('1.2 s')
    const generateVal = screen.getByText('4.2 s')
    expect(firstTokenVal.className).toContain('shrink')
    expect(firstTokenVal.className).toContain('truncate')
    expect(firstTokenVal.className).not.toContain('shrink-0')
    expect(generateVal.className).toContain('shrink')
    expect(generateVal.className).toContain('truncate')
    expect(generateVal.className).not.toContain('shrink-0')

    const root = container.firstElementChild as HTMLElement
    expect(root).toHaveAttribute(
      'title',
      'First token: 1.2 s · Generate: 4.2 s'
    )
  })
})

describe('StreamTpsCell', () => {
  test('renders normal stream throughput label', () => {
    render(
      <StreamTpsCell
        isStream
        throughput={{
          tokensPerSecond: 120,
          isBurst: false,
          outputMs: 1000,
          overallTokensPerSecond: 80,
        }}
      />
    )

    expect(screen.getByText('Stream')).toBeInTheDocument()
    expect(screen.getByText('120 t/s')).toBeInTheDocument()
    expect(screen.queryByText('Burst')).not.toBeInTheDocument()
  })

  test('renders burst indicator and shows redesigned tooltip on hover', async () => {
    render(
      <StreamTpsCell
        isStream
        throughput={{
          tokensPerSecond: null,
          isBurst: true,
          outputMs: 46,
          overallTokensPerSecond: 42.4,
        }}
      />
    )

    // First line shows Stream
    expect(screen.getByText('Stream')).toBeInTheDocument()
    // Second line shows t/s
    expect(screen.getByText('t/s')).toBeInTheDocument()

    const burstTrigger = screen.getByRole('button', { name: 'Burst Streaming' })
    expect(burstTrigger).toBeInTheDocument()
    expect(burstTrigger).toHaveClass('text-amber-600/70', 'cursor-help')
    expect(burstTrigger).not.toHaveClass('underline', 'hover:underline')

    // Hover trigger to open tooltip
    fireEvent.pointerEnter(burstTrigger)
    fireEvent.focus(burstTrigger)

    // Base UI tooltip popup
    const heading = await screen.findByText('Burst Streaming')
    expect(heading).toBeInTheDocument()

    expect(
      screen.getByText(
        'Upstream delivered tokens in an instant burst instead of a steady stream.'
      )
    ).toBeInTheDocument()

    expect(screen.getByText('Generation duration')).toBeInTheDocument()
    expect(screen.getByText('46 ms')).toBeInTheDocument()
    expect(screen.getByText('Overall rate')).toBeInTheDocument()
    expect(screen.getByText('42 t/s')).toBeInTheDocument()
  })

  test('renders Chinese translated copy when bundle is loaded', async () => {
    act(() => {
      i18next.addResourceBundle(
        'zhCN',
        'translation',
        zhCN.translation,
        true,
        true
      )
    })

    render(
      <StreamTpsCell
        isStream
        throughput={{
          tokensPerSecond: null,
          isBurst: true,
          outputMs: 46,
          overallTokensPerSecond: 42,
        }}
      />
    )

    // 第一行保留正常的“流”
    expect(screen.getByText('流')).toBeInTheDocument()
    // 第二行保留“t/s”
    expect(screen.getByText('t/s')).toBeInTheDocument()

    const burstTrigger = screen.getByRole('button', { name: '脉冲流式' })
    expect(burstTrigger).toBeInTheDocument()
    expect(burstTrigger).toHaveClass('cursor-help')
    expect(burstTrigger).not.toHaveClass('underline', 'hover:underline')

    fireEvent.pointerEnter(burstTrigger)
    fireEvent.focus(burstTrigger)

    const heading = await screen.findByText('脉冲流式')
    expect(heading).toBeInTheDocument()

    expect(
      screen.getByText('上游瞬时集中推送，未形成平稳流速。')
    ).toBeInTheDocument()
    expect(screen.getByText('生成耗时')).toBeInTheDocument()
    expect(screen.getByText('46 ms')).toBeInTheDocument()
    expect(screen.getByText('全程均速')).toBeInTheDocument()
    expect(screen.getByText('42 t/s')).toBeInTheDocument()
  })

  test('omits metrics section when both outputMs and overallTps are null', async () => {
    render(
      <StreamTpsCell
        isStream
        throughput={{
          tokensPerSecond: null,
          isBurst: true,
        }}
      />
    )

    const burstTrigger = screen.getByRole('button', { name: 'Burst Streaming' })
    fireEvent.pointerEnter(burstTrigger)
    fireEvent.focus(burstTrigger)

    await screen.findByText('Burst Streaming')
    expect(screen.queryByText('Generation duration')).not.toBeInTheDocument()
    expect(screen.queryByText('Overall rate')).not.toBeInTheDocument()
  })

  test('opens burst streaming popup on click/touch, supports touch target styles, and dismisses on outside click', async () => {
    render(
      <div>
        <button type='button'>Outside element</button>
        <StreamTpsCell
          isStream
          throughput={{
            tokensPerSecond: null,
            isBurst: true,
            outputMs: 35,
            overallTokensPerSecond: 60,
          }}
        />
      </div>
    )

    const burstTrigger = screen.getByRole('button', { name: 'Burst Streaming' })
    expect(burstTrigger).toBeInTheDocument()
    expect(burstTrigger).toHaveClass(
      'touch-manipulation',
      'active:text-amber-600',
      'data-popup-open:text-amber-600'
    )

    const zapIcon = burstTrigger.querySelector('svg')
    expect(zapIcon).toHaveClass(
      'group-active/burst:fill-amber-500/80',
      'group-data-popup-open/burst:fill-amber-500/80'
    )

    // Tap/click trigger opens the popover
    fireEvent.click(burstTrigger)

    const heading = await screen.findByText('Burst Streaming')
    expect(heading).toBeInTheDocument()
    expect(screen.getByText('35 ms')).toBeInTheDocument()
    expect(screen.getByText('60 t/s')).toBeInTheDocument()

    // Clicking outside dismisses the popover
    const outside = screen.getByRole('button', { name: 'Outside element' })
    fireEvent.click(outside)

    expect(screen.queryByText('35 ms')).not.toBeInTheDocument()
  })

  test('does not flash closed on first click or when re-clicked after interacting elsewhere', async () => {
    render(
      <div>
        <button type='button'>Elsewhere</button>
        <StreamTpsCell
          isStream
          throughput={{
            tokensPerSecond: null,
            isBurst: true,
            outputMs: 25,
            overallTokensPerSecond: 80,
          }}
        />
      </div>
    )

    const burstTrigger = screen.getByRole('button', { name: 'Burst Streaming' })
    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })

    // Scenario 1: First click (pointerdown -> focus -> click in real browser)
    fireEvent.pointerDown(burstTrigger)
    fireEvent.focus(burstTrigger)
    fireEvent.click(burstTrigger)

    // Must remain open
    expect(await screen.findByText('Burst Streaming')).toBeInTheDocument()
    expect(screen.getByText('25 ms')).toBeInTheDocument()

    // Scenario 2: Interact elsewhere (blur trigger, close popover)
    fireEvent.click(elsewhere)
    fireEvent.blur(burstTrigger)
    expect(screen.queryByText('25 ms')).not.toBeInTheDocument()

    // Scenario 3: Return and re-click (pointerdown -> focus -> click again)
    fireEvent.pointerDown(burstTrigger)
    fireEvent.focus(burstTrigger)
    fireEvent.click(burstTrigger)

    // Must cleanly stay open and not flash closed
    expect(await screen.findByText('Burst Streaming')).toBeInTheDocument()
    expect(screen.getByText('25 ms')).toBeInTheDocument()
  })
})
