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

  it('sizes its box from the number in the card, and keeps the query a definite width', () => {
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
    // the control stays as wide as what it holds and needs nothing else.
    expect(classesOf(table.control)).not.toContain('max-w-[5.5rem]')
    expect(classesOf(table.wrapper)).not.toContain('min-w-[5rem]')
    expect(classesOf(table.wrapper)).not.toContain('justify-center')

    // The card's columns are sized by these figures, so the control is sized by
    // the number it holds, up to the 5.5rem ceiling it used to be given and never
    // squeezed below what the number and its two buttons need. The wrapper keeps
    // the 5rem floor the +/- buttons appear at through their container query: a
    // box the buttons themselves could size would collapse to the value alone and
    // never answer that query again.
    expect(classesOf(card.control)).toContain('min-w-fit')
    expect(classesOf(card.control)).toContain('max-w-[5.5rem]')
    expect(classesOf(card.value as HTMLElement)).toContain('max-w-16')
    expect(classesOf(card.wrapper)).toContain('min-w-[5rem]')
    expect(classesOf(card.wrapper)).toContain('justify-center')
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

  it('prevents the control from collapsing when showing a placeholder in table and card modes', () => {
    const parts = (container: HTMLElement) => {
      const wrapper = container.firstElementChild as HTMLElement
      const control = wrapper.firstElementChild as HTMLElement
      return { wrapper, control, value: control.querySelectorAll('button')[1] }
    }

    const table = parts(
      render(
        <ChannelRowActionsLayoutContext.Provider value='table'>
          <NumericSpinnerInput
            value={null}
            placeholder='—'
            placeholderDescription='the channels disagree'
            onChange={() => {}}
          />
        </ChannelRowActionsLayoutContext.Provider>
      ).container
    )
    const card = parts(
      render(
        <ChannelRowActionsLayoutContext.Provider value='card'>
          <NumericSpinnerInput
            value={null}
            placeholder='—'
            placeholderDescription='the channels disagree'
            onChange={() => {}}
          />
        </ChannelRowActionsLayoutContext.Provider>
      ).container
    )

    // When the +/- buttons are taken out of the layout for a valueless placeholder,
    // the control maintains width so it does not collapse into a small square/circle,
    // while min-w-0 max-w-full ensures it can compress instead of clipping when squeezed.
    expect(classesOf(table.control)).toContain('w-[4.75rem]')
    expect(classesOf(table.control)).toContain('min-w-0')
    expect(classesOf(table.control)).toContain('max-w-full')
    expect(classesOf(table.control)).toContain('justify-center')
    expect(classesOf(table.value as HTMLElement)).toContain('max-w-full')

    // In card mode, min-w-fit must not override when showing a dash.
    expect(classesOf(card.control)).toContain('w-[4.75rem]')
    expect(classesOf(card.control)).not.toContain('min-w-fit')
    expect(classesOf(card.control)).toContain('max-w-[5.5rem]')
  })

  it('gives the input full width when editing a placeholder so it does not jump', async () => {
    const user = userEvent.setup()
    render(
      <NumericSpinnerInput
        value={null}
        placeholder='—'
        placeholderDescription='the channels disagree'
        onChange={() => {}}
      />
    )

    await user.click(screen.getByLabelText('the channels disagree'))
    const input = screen.getByRole('textbox')
    expect(classesOf(input)).toContain('w-full')
  })
})
