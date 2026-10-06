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
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'

import { ChannelRowActionsLayoutContext } from '../channel-row-actions-context'
import { NumericSpinnerInput } from '../numeric-spinner-input'

/**
 * jsdom lays nothing out, so the container query cannot be evaluated here; what
 * these cases protect is the contract the query encodes — which element is
 * sized by the column, and the order in which the value and the +/- buttons
 * give way. The class list is read as tokens, because a substring check would
 * let `max-w-full` pass for `w-full` and hide exactly the regression below.
 */
const classesOf = (element: HTMLElement) =>
  (element.className || '').split(/\s+/)

describe('channel numeric spinner', () => {
  it('keeps the value shrinkable so text gives way before the buttons', () => {
    render(<NumericSpinnerInput value={99} onChange={() => {}} />)

    const value = classesOf(screen.getByTitle('99'))
    expect(value).toContain('min-w-0')
    expect(value).toContain('flex-1')
  })

  it('hides the increment and decrement buttons until the column can hold them', () => {
    render(<NumericSpinnerInput value={99} onChange={() => {}} />)

    for (const label of ['Decrement', 'Increment']) {
      // `hidden` until the container is wide enough, then `flex`: the buttons
      // are dropped rather than hanging half outside the column. The threshold
      // is the width at which the buttons and a readable value both fit, so a
      // column that shows them never squeezes the value down to a sliver.
      const button = classesOf(screen.getByLabelText(label))
      expect(button).toContain('hidden')
      expect(button).toContain('@[5rem]/spinner:flex')
    }
  })

  it('sizes the query container from its column, not from the content it gates', () => {
    const { container } = render(
      <NumericSpinnerInput value={1} onChange={() => {}} />
    )

    const wrapper = container.firstElementChild as HTMLElement
    // The +/- buttons are part of this box's content, and the query on this box
    // decides whether they are rendered. A box sized by its own content is
    // therefore sized by the answer to its own question: with the buttons hidden
    // the content measures a few pixels and the query stays false, so the
    // spinner collapses inside a column with room to spare. Taking its width
    // from the column breaks that loop, which is what `w-full` is for.
    expect(wrapper.className).toContain('@container/spinner')
    expect(classesOf(wrapper)).toContain('w-full')
    expect(classesOf(wrapper)).toContain('min-w-0')
  })

  it('takes 85% of its column in the card, up to the width it used to be given', () => {
    const parts = (container: HTMLElement) => {
      const wrapper = container.firstElementChild as HTMLElement
      const control = wrapper.firstElementChild as HTMLElement
      return { wrapper, control, value: control.querySelectorAll('button')[1] }
    }

    const table = parts(
      render(
        <ChannelRowActionsLayoutContext.Provider value='table'>
          <NumericSpinnerInput value={99} onChange={() => {}} />
        </ChannelRowActionsLayoutContext.Provider>
      ).container
    )
    const card = parts(
      render(
        <ChannelRowActionsLayoutContext.Provider value='card'>
          <NumericSpinnerInput value={99} onChange={() => {}} />
        </ChannelRowActionsLayoutContext.Provider>
      ).container
    )

    // The table measures its columns from the content, where a box that stretched
    // would be asking the column to size itself from the box filling it, so there
    // the control stays as wide as what it holds.
    expect(classesOf(table.control)).not.toContain('w-[min(5.5rem,85%)]')
    // The card gives the spinner a column of its own in an equal-thirds grid: the
    // control takes 85% of it, never more than the 5.5rem track the spinner used
    // to be given, and never less than the number and its two buttons need — the
    // buttons alone are 48px of the box, so 85% of the narrowest card would
    // ellipsize a two-digit value.
    expect(classesOf(card.control)).toContain('w-[min(5.5rem,85%)]')
    expect(classesOf(card.control)).toContain('min-w-fit')
    expect(classesOf(card.value as HTMLElement)).toContain('max-w-16')
    // The card centres each figure in its column, so the box sits in the middle
    // of the track rather than against its left edge; the table's box is the
    // width of its own content, so there is nothing left to centre.
    expect(classesOf(card.wrapper)).toContain('justify-center')
    expect(classesOf(table.wrapper)).not.toContain('justify-center')
  })

  it('shows the placeholder instead of a zero when the caller has no single value', () => {
    render(
      <NumericSpinnerInput
        value={null}
        placeholder='—'
        placeholderDescription='the channels disagree'
        onChange={() => {}}
      />
    )

    const value = screen.getByLabelText('the channels disagree')
    expect(value).toHaveTextContent('—')
    // Nothing to step from, so the buttons are taken out of the layout and
    // disabled rather than nudging a number that is not there.
    for (const label of ['Decrement', 'Increment']) {
      const button = screen.getByLabelText(label)
      expect(button).toBeDisabled()
      expect(classesOf(button)).not.toContain('@[5rem]/spinner:flex')
    }
  })

  it('keeps printing a real zero for a caller that passes no placeholder', () => {
    render(<NumericSpinnerInput value={null} onChange={() => {}} />)

    expect(screen.getByTitle('0')).toHaveTextContent('0')
    expect(screen.getByLabelText('Increment')).toBeEnabled()
  })

  it('treats the first number typed into a value-less control as a change', async () => {
    const user = userEvent.setup()
    const changes: number[] = []
    render(
      <NumericSpinnerInput
        value={null}
        placeholder='—'
        placeholderDescription='the channels disagree'
        onChange={(value) => changes.push(value)}
      />
    )

    await user.click(screen.getByLabelText('the channels disagree'))
    const input = screen.getByRole('textbox')
    expect(input).toHaveValue('')
    await user.type(input, '0')
    await user.keyboard('{Enter}')

    // Zero equals the display a missing value used to fall back to, but here it
    // is a value the user chose and it has to reach the caller.
    expect(changes).toEqual([0])
  })
})
