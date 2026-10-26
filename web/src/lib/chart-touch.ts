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
import { useEffect, type RefObject } from 'react'

/**
 * The tooltip settings every VChart surface in this app shares, so a finger can
 * read a chart and not just a mouse.
 *
 * VChart is told to render in `desktop-browser` mode (see `VCHART_OPTION`), and
 * that mode defines the tooltip's own `hover` trigger as `pointermove` alone. A
 * stationary tap never emits `pointermove`, so without `click` in the trigger a
 * tap moved nothing: the value under the finger stayed unreadable on a phone and
 * on a touchscreen laptop. `enterable: false` keeps the panel out of the pointer
 * path, so a tap that lands on the panel still reports the point underneath
 * instead of freezing the highlight.
 */
export const TOUCH_TOOLTIP_SPEC = {
  trigger: ['hover', 'click'],
  enterable: false,
} as const

/**
 * Binds a cartesian chart's crosshair to its tooltip instead of to its own
 * hover listener.
 *
 * VChart gives every cartesian chart a default crosshair - the translucent
 * grey column marking the hovered band - and that crosshair listens to hover on
 * its own. In `desktop-browser` mode (see `VCHART_OPTION`) hover means
 * `pointermove` alone, so a stationary tap moved the tooltip but never the grey
 * column: on a touchscreen the column only followed a sliding finger, never a
 * tap. `followTooltip: true` makes the crosshair show and move with the tooltip,
 * so the column and the value can never disagree - on a tap, a drag or a mouse
 * hover alike. The chart's default `xField` rect column is preserved because
 * VChart merges this into the default crosshair spec.
 */
export const CROSSHAIR_FOLLOW_TOOLTIP = {
  followTooltip: true,
} as const

/**
 * Keeps a touch selection on screen after the finger lifts.
 *
 * For a pointer that never hovers, the spec fires `pointerout`/`pointerleave`
 * right after `pointerup` ("a pointer that does not need to hover left"). vrender
 * listens for `pointerleave` on the canvas in the capture phase and VChart reads
 * it as the pointer leaving the chart, hiding the tooltip the user had just
 * tapped open - so "hold, drag, let go" showed a value for as long as the finger
 * was down and lost it the moment it came up. Only a mouse really leaving should
 * end the selection, so the touch leave is swallowed here.
 *
 * The listener runs in the capture phase on the chart's host element, ahead of
 * the one on the canvas. A tap outside the plot still dismisses the tooltip,
 * because that arrives as a window `pointerup` whose position VChart checks
 * itself.
 */
export function useTouchTooltipHold(hostRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const holdTouchSelection = (event: PointerEvent) => {
      if (event.pointerType === 'touch') event.stopPropagation()
    }
    host.addEventListener('pointerleave', holdTouchSelection, true)
    return () => {
      host.removeEventListener('pointerleave', holdTouchSelection, true)
    }
  }, [hostRef])
}
