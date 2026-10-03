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
import { useRef, type MouseEvent, type PointerEvent } from 'react'

import { TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const DRAG_THRESHOLD_PX = 4

export type RatioTabStripItem = {
  value: string
  label: string
}

/**
 * Settings tab strip that stays usable when the tabs are wider than the page.
 *
 * On narrow viewports the fixed column grid is replaced by a horizontally
 * scrolling strip, and a pointer drag scrolls it too, so tabs that start off
 * screen can still be reached. A drag never activates the tab it ended on.
 */
export function RatioTabStrip(props: {
  items: RatioTabStripItem[]
  columnsClassName: string
}) {
  const drag = useRef<{
    pointerId: number
    startX: number
    startScroll: number
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const strip = event.currentTarget
    suppressClick.current = false
    if (strip.scrollWidth <= strip.clientWidth) return
    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startScroll: strip.scrollLeft,
      moved: false,
    }
    if (typeof strip.setPointerCapture === 'function') {
      strip.setPointerCapture(event.pointerId)
    }
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const delta = event.clientX - current.startX
    if (!current.moved && Math.abs(delta) < DRAG_THRESHOLD_PX) return
    current.moved = true
    event.preventDefault()
    event.currentTarget.scrollLeft = current.startScroll - delta
  }

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const strip = event.currentTarget
    if (
      typeof strip.hasPointerCapture === 'function' &&
      typeof strip.releasePointerCapture === 'function' &&
      strip.hasPointerCapture(event.pointerId)
    ) {
      strip.releasePointerCapture(event.pointerId)
    }
    suppressClick.current = current.moved
    drag.current = null
  }

  const handleClickCapture = (event: MouseEvent<HTMLDivElement>) => {
    if (!suppressClick.current) return
    suppressClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  return (
    <TabsList
      className={cn(
        'no-scrollbar grid w-fit max-w-full',
        props.columnsClassName,
        'max-sm:flex max-sm:justify-start max-sm:overflow-x-auto max-sm:overscroll-x-contain'
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onClickCapture={handleClickCapture}
    >
      {props.items.map((item) => (
        <TabsTrigger
          key={item.value}
          value={item.value}
          className='max-sm:flex-none'
        >
          {item.label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
