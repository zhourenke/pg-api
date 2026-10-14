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
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * The delay applied to typed filter text. Every other control applies on
 * selection, which cannot fire faster than a person can click; a text field
 * fires once per keystroke, so it needs to settle first.
 */
const TEXT_FILTER_DEBOUNCE_MS = 1000

/**
 * Runs `onChange` once the value has stopped changing for `delay`, and reports
 * whether an edit is still waiting.
 *
 * The value is held for the whole pending window rather than only for the tick
 * that changes it, because the effect below compares against it: if it tracked
 * the latest value instead, an edit that arrives after the timer fired would
 * see them as equal and never be applied at all.
 *
 * A pending edit is applied before the component goes away, so navigating off
 * the page right after typing does not silently drop it.
 */
export function useDebouncedFilterChange<T>(
  onChange: (value: T) => void,
  delay: number = TEXT_FILTER_DEBOUNCE_MS
): {
  change: (value: T) => void
  isPending: boolean
  flush: () => void
} {
  const [pending, setPending] = useState<{ value: T } | null>(null)
  const [debounced, setDebounced] = useState<{ value: T } | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const pendingRef = useRef<{ value: T } | null>(null)
  pendingRef.current = pending

  useEffect(() => {
    if (!pending) return
    const timer = setTimeout(() => {
      setDebounced(pending)
      setPending(null)
    }, delay)
    return () => clearTimeout(timer)
  }, [delay, pending])

  useEffect(() => {
    if (!debounced) return
    setDebounced(null)
    onChangeRef.current(debounced.value)
  }, [debounced])

  const flush = useCallback(() => {
    const waiting = pendingRef.current
    if (!waiting) return
    pendingRef.current = null
    setPending(null)
    onChangeRef.current(waiting.value)
  }, [])

  useEffect(() => flush, [flush])

  const change = useCallback((value: T) => {
    setPending({ value })
  }, [])

  return { change, isPending: pending !== null, flush }
}
