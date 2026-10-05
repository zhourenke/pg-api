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
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { NumericSpinnerInput } from '../numeric-spinner-input'

/**
 * jsdom lays nothing out, so the container query cannot be evaluated here; what
 * these cases protect is the degradation order that the query encodes — the
 * value is allowed to shrink, and the +/- buttons are the first thing to go
 * when the column is too narrow for them.
 */
describe('channel numeric spinner', () => {
  it('keeps the value shrinkable so text gives way before the buttons', () => {
    render(<NumericSpinnerInput value={99} onChange={() => {}} />)

    const value = screen.getByTitle('99')
    expect(value.className).toContain('min-w-0')
    expect(value.className).toContain('flex-1')
  })

  it('hides the increment and decrement buttons in a narrow column', () => {
    render(<NumericSpinnerInput value={99} onChange={() => {}} />)

    for (const label of ['Decrement', 'Increment']) {
      const button = screen.getByLabelText(label)
      // `hidden` until the container is wide enough, then `flex`: the buttons
      // are dropped rather than hanging half outside the column.
      expect(button.className).toContain('hidden')
      expect(button.className).toContain('@[3.5rem]/spinner:flex')
    }
  })

  it('makes the wrapper a query container sized by its column', () => {
    const { container } = render(
      <NumericSpinnerInput value={1} onChange={() => {}} />
    )

    const wrapper = container.firstElementChild as HTMLElement
    expect(wrapper.className).toContain('@container/spinner')
    expect(wrapper.className).toContain('min-w-0')
    expect(wrapper.className).toContain('max-w-full')
  })
})
