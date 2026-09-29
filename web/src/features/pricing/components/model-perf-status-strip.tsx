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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSuccessRateDotClass } from '@/features/performance-metrics/lib/format'
import type { SuccessRatePoint } from '@/features/performance-metrics/types'
import { cn } from '@/lib/utils'

const SLOT_COUNT = 24
const SLOT_GAP_PX = 1
const SECONDS_PER_HOUR = 3600

export interface ModelPerfStatusStripProps {
  /** Hour-aligned start of the 24-hour window, in seconds. */
  windowStart?: number
  /** Sparse hourly samples; hours without traffic render as empty slots. */
  series?: SuccessRatePoint[]
}

function buildSlotRates(
  windowStart: number | undefined,
  series: SuccessRatePoint[] | undefined
): Array<number | undefined> {
  const rates = Array.from(
    { length: SLOT_COUNT },
    () => undefined as number | undefined
  )
  if (windowStart == null) return rates

  const byHour = new Map<number, number>()
  for (const point of series ?? []) {
    if (Number.isFinite(point.success_rate))
      byHour.set(point.ts, point.success_rate)
  }
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const rate = byHour.get(windowStart + slot * SECONDS_PER_HOUR)
    if (rate != null && rate >= 0 && rate <= 100) rates[slot] = rate
  }
  return rates
}

/**
 * Whole-pixel slot widths so the bars stay crisp at any zoom level. Splitting
 * the width evenly instead would leave each bar on a fractional pixel and make
 * the gaps drift.
 */
function buildSlotWidths(width: number): number[] {
  const usable = Math.floor(width) - SLOT_GAP_PX * (SLOT_COUNT - 1)
  if (usable < SLOT_COUNT) return []
  const base = Math.floor(usable / SLOT_COUNT)
  const remainder = usable - base * SLOT_COUNT
  return Array.from({ length: SLOT_COUNT }, (_, slot) =>
    slot < remainder ? base + 1 : base
  )
}

function formatHour(hourTs: number): string {
  return String(new Date(hourTs * 1000).getHours()).padStart(2, '0')
}

export function ModelPerfStatusStrip(props: ModelPerfStatusStripProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  const [activeSlot, setActiveSlot] = useState<number | null>(null)

  const slotRates = useMemo(
    () => buildSlotRates(props.windowStart, props.series),
    [props.windowStart, props.series]
  )
  const slotWidths = useMemo(() => buildSlotWidths(width), [width])

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const next = Math.floor(entries[0]?.contentRect.width ?? 0)
      setWidth((current) => (current === next ? current : next))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  // The full strip is the hit area, so a pointer that lands between two bars
  // still resolves to the nearest hour instead of reporting nothing.
  const resolveSlot = useCallback((clientX: number): number | null => {
    const element = containerRef.current
    if (!element) return null
    const rect = element.getBoundingClientRect()
    if (!(rect.width > 0)) return null
    const slot = Math.floor(((clientX - rect.left) / rect.width) * SLOT_COUNT)
    return Math.min(SLOT_COUNT - 1, Math.max(0, slot))
  }, [])

  // Touch keeps its tooltip until the user taps somewhere else.
  useEffect(() => {
    if (activeSlot == null) return
    const dismiss = (event: PointerEvent) => {
      const element = containerRef.current
      if (
        element &&
        event.target instanceof Node &&
        element.contains(event.target)
      ) {
        return
      }
      setActiveSlot(null)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [activeSlot])

  const activeHourTs =
    activeSlot == null || props.windowStart == null
      ? null
      : props.windowStart + activeSlot * SECONDS_PER_HOUR
  const activeRate = activeSlot == null ? undefined : slotRates[activeSlot]
  const tipText = t('Hour {{hour}}: {{rate}}', {
    hour: activeHourTs == null ? '' : formatHour(activeHourTs),
    rate:
      activeRate == null ? t('No data available') : `${activeRate.toFixed(2)}%`,
  })

  const slotClassName = (slot: number) => {
    const rate = slotRates[slot]
    return rate == null
      ? 'bg-muted-foreground/15'
      : getSuccessRateDotClass(rate)
  }
  // Whole-pixel widths only exist once the container has been measured; before
  // that (first paint, no ResizeObserver) an even grid keeps the same 24 slots.
  const measured = slotWidths.length === SLOT_COUNT

  return (
    <div
      ref={containerRef}
      className='relative h-3 w-24'
      onPointerMove={(event) => setActiveSlot(resolveSlot(event.clientX))}
      onPointerDown={(event) => {
        const slot = resolveSlot(event.clientX)
        setActiveSlot(slot)
        if (slot != null && event.pointerType !== 'mouse') {
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== 'mouse') return
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) return
        setActiveSlot(null)
      }}
    >
      <div
        role='img'
        aria-label={t(
          'Recent success-rate samples; gray bars indicate missing data.'
        )}
        title={t(
          'Recent success-rate samples; gray bars indicate missing data.'
        )}
        className={cn(
          'h-full gap-px',
          measured
            ? 'flex items-stretch'
            : 'grid grid-cols-[repeat(24,minmax(0,1fr))] items-stretch'
        )}
      >
        {slotRates.map((_, slot) => (
          <span
            key={slot}
            aria-hidden
            className={cn('rounded-xs', slotClassName(slot))}
            style={measured ? { width: `${slotWidths[slot]}px` } : undefined}
          />
        ))}
      </div>

      {activeHourTs != null && (
        <div
          role='tooltip'
          className={cn(
            'bg-foreground text-background absolute bottom-full z-20 mb-1 rounded-md px-2 py-1 text-[11px] font-medium whitespace-nowrap shadow-md',
            activeSlot != null && activeSlot < SLOT_COUNT / 2
              ? 'left-0'
              : 'right-0'
          )}
        >
          {tipText}
        </div>
      )}
    </div>
  )
}
