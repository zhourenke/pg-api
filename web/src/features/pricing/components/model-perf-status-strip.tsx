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
const SLOT_GAP_CSS_PX = 1
const SECONDS_PER_HOUR = 3600

export interface ModelPerfStatusStripProps {
  /** Hour-aligned start of the 24-hour window, in seconds. */
  windowStart?: number
  /** Sparse hourly samples; hours without traffic render as empty slots. */
  series?: SuccessRatePoint[]
}

type StripLayout = {
  /** Device pixels to nudge the row so the first bar starts on the grid. */
  offsetDev: number
  ratio: number
  /** Device-pixel pitch of one slot, used for hit testing. */
  pitchDev: number
  gapCss: number
  widthCss: number[]
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
    if (Number.isFinite(point.success_rate)) {
      byHour.set(point.ts, point.success_rate)
    }
  }
  for (let slot = 0; slot < SLOT_COUNT; slot += 1) {
    const rate = byHour.get(windowStart + slot * SECONDS_PER_HOUR)
    if (rate != null && rate >= 0 && rate <= 100) rates[slot] = rate
  }
  return rates
}

function devicePixelRatio(): number {
  const ratio = globalThis.devicePixelRatio
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1
}

/**
 * The bars have to land on real device pixels, not CSS pixels: on a 2x display
 * an odd CSS width covers three device pixels while its neighbour covers four,
 * and a row starting at a fractional position blurs every edge. Measuring and
 * dividing in device pixels keeps all bars the same weight, keeps the gaps
 * uniform, and never spreads the remainder over more than one device pixel.
 */
function buildLayout(rect: {
  left: number
  width: number
}): StripLayout | null {
  const ratio = devicePixelRatio()
  // Round the device position first so a fractional CSS offset does not turn
  // into 0.1999999999999993px of margin.
  const leftDev = Math.round(rect.left * ratio * 1000) / 1000
  const rightDev = Math.round((rect.left + rect.width) * ratio * 1000) / 1000
  const startDev = Math.ceil(leftDev)
  const endDev = Math.floor(rightDev)
  const gapDev = Math.max(1, Math.round(SLOT_GAP_CSS_PX * ratio))
  const usableDev = endDev - startDev - gapDev * (SLOT_COUNT - 1)
  if (usableDev < SLOT_COUNT) return null
  const base = Math.floor(usableDev / SLOT_COUNT)
  const remainder = usableDev - base * SLOT_COUNT
  return {
    // The subtraction is lossy in binary (21 - 20.6 is 0.3999999999999986), and
    // the remainder is applied as a CSS margin.
    offsetDev: Math.round((startDev - leftDev) * 1000) / 1000,
    ratio,
    pitchDev: (endDev - startDev) / SLOT_COUNT,
    gapCss: gapDev / ratio,
    widthCss: Array.from(
      { length: SLOT_COUNT },
      (_, slot) => (slot < remainder ? base + 1 : base) / ratio
    ),
  }
}

function sameLayout(current: StripLayout | null, next: StripLayout | null) {
  if (current === next) return true
  if (!current || !next) return false
  return (
    current.offsetDev === next.offsetDev &&
    current.ratio === next.ratio &&
    current.gapCss === next.gapCss &&
    current.widthCss.length === next.widthCss.length &&
    current.widthCss.every((width, slot) => width === next.widthCss[slot])
  )
}

function formatHour(hourTs: number): string {
  return String(new Date(hourTs * 1000).getHours()).padStart(2, '0')
}

/**
 * The strip is a fixed 24-slot grid, so the hour is the stable identity; the
 * window start is still unknown before the summary arrives.
 */
function slotKey(windowStart: number | undefined, slot: number): string {
  if (windowStart == null) return `slot-${slot}`
  return `hour-${windowStart + slot * SECONDS_PER_HOUR}`
}

export function ModelPerfStatusStrip(props: ModelPerfStatusStripProps) {
  const { t } = useTranslation()
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [layout, setLayout] = useState<StripLayout | null>(null)
  const [activeSlot, setActiveSlot] = useState<number | null>(null)

  const slotRates = useMemo(
    () => buildSlotRates(props.windowStart, props.series),
    [props.windowStart, props.series]
  )

  useEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      const next = buildLayout(element.getBoundingClientRect())
      setLayout((current) => (sameLayout(current, next) ? current : next))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    // Browser zoom keeps the CSS size and changes the device pixel ratio, which
    // the observer never reports.
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])

  // The full strip is the hit area, so a pointer that lands between two bars
  // still resolves to the nearest hour instead of reporting nothing.
  const resolveSlot = useCallback(
    (clientX: number): number | null => {
      const element = containerRef.current
      if (!element) return null
      const rect = element.getBoundingClientRect()
      if (!(rect.width > 0)) return null
      // Before the grid is measured, fall back to a proportional hit test.
      const xDev = layout
        ? (clientX - rect.left) * layout.ratio - layout.offsetDev
        : clientX - rect.left
      const stride = layout ? layout.pitchDev : rect.width / SLOT_COUNT
      const slot = Math.floor(xDev / stride)
      return Math.min(SLOT_COUNT - 1, Math.max(0, slot))
    },
    [layout]
  )

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
          'h-full',
          layout
            ? 'flex items-stretch'
            : 'grid grid-cols-[repeat(24,minmax(0,1fr))] items-stretch gap-px'
        )}
        // Device-pixel widths only exist once the strip is measured; the even
        // grid above covers the first paint and environments without a DPR.
        style={
          layout
            ? {
                marginLeft: layout.offsetDev / layout.ratio,
                columnGap: layout.gapCss,
              }
            : undefined
        }
      >
        {slotRates.map((_, slot) => (
          <span
            key={slotKey(props.windowStart, slot)}
            aria-hidden
            className={cn('rounded-xs', slotClassName(slot))}
            style={layout ? { width: layout.widthCss[slot] } : undefined}
          />
        ))}
      </div>

      {activeHourTs != null && (
        <div
          role='tooltip'
          className={cn(
            'bg-popover text-popover-foreground border-border absolute bottom-full z-20 mb-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap shadow-md',
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
