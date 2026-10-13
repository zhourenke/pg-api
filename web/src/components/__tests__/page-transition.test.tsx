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
import { render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PageTransition } from '../page-transition'

// The shared suite prefers reduced motion, and that branch renders the children
// in a plain div without any entrance style, so a test that wants to observe
// what the animation writes to the DOM has to opt back into motion.
function renderAnimatedPage(): HTMLElement {
  const original = window.matchMedia
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...original(query),
    matches: false,
  }))

  const { container } = render(<PageTransition>probe</PageTransition>)
  return container.firstElementChild as HTMLElement
}

afterEach(() => {
  vi.restoreAllMocks()
})

it('keeps a CSS filter off the page wrapper, from the first frame to the settled state', async () => {
  const page = renderAnimatedPage()

  // A filter on an ancestor of the table mixes into text rendering, and even
  // `blur(0px)` stays in the inline style after the animation, so the wrapper
  // must never carry one.
  expect(page.style.filter).toBe('')

  await waitFor(() => expect(page.style.opacity).toBe('1'))

  expect(page.style.filter).toBe('')
})

it('still renders the page entrance as an opacity fade that rises into place', async () => {
  const page = renderAnimatedPage()

  expect(page.style.opacity).toBe('0')
  expect(page.style.transform).toBe('translateY(8px)')

  await waitFor(() => expect(page.style.opacity).toBe('1'))
})
