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
import { describe, expect, it } from 'vitest'

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../tooltip'

describe('Tooltip bubble design system', () => {
  it('applies light/dark surface tokens (bg-popover, text-popover-foreground, border-border) instead of inverted colors', async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<button type='button'>Hover me</button>} />
          <TooltipContent>Helpful info</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )

    const trigger = screen.getByRole('button', { name: 'Hover me' })
    fireEvent.pointerEnter(trigger)
    fireEvent.focus(trigger)

    const content = await screen.findByText('Helpful info')
    const popup = content.closest('[data-slot="tooltip-content"]')
    expect(popup).toBeInTheDocument()

    // Assert consistent bubble surface tokens
    expect(popup?.className).toContain('bg-popover')
    expect(popup?.className).toContain('text-popover-foreground')
    expect(popup?.className).toContain('border-border')
    expect(popup?.className).toContain('border')
    expect(popup?.className).toContain('shadow-md')

    // Must NOT use old harsh inverted foreground/background tokens
    expect(popup?.className).not.toContain('bg-foreground')
    expect(popup?.className).not.toContain('text-background')

    // Arrow exists and uses matching popover tokens
    const arrow = popup?.querySelector('[data-slot="tooltip-arrow"]')
    expect(arrow).toBeInTheDocument()
    expect(arrow?.className).toContain('before:bg-popover')
    expect(arrow?.className).toContain('before:border-border')
    expect(arrow?.className).not.toContain('bg-foreground')
    expect(arrow?.className).not.toContain('fill-foreground')
  })

  it('supports hiding the arrow via showArrow={false}', async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<button type='button'>No arrow</button>} />
          <TooltipContent showArrow={false}>Flat bubble</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )

    const trigger = screen.getByRole('button', { name: 'No arrow' })
    fireEvent.pointerEnter(trigger)
    fireEvent.focus(trigger)

    const content = await screen.findByText('Flat bubble')
    const popup = content.closest('[data-slot="tooltip-content"]')
    expect(popup).toBeInTheDocument()

    const arrow = popup?.querySelector('[data-slot="tooltip-arrow"]')
    expect(arrow).toBeNull()
  })

  it('merges custom className without losing bubble border and popover colors', async () => {
    render(
      <TooltipProvider delay={0}>
        <Tooltip>
          <TooltipTrigger render={<button type='button'>Custom</button>} />
          <TooltipContent className='w-64 p-3'>Detailed card</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )

    const trigger = screen.getByRole('button', { name: 'Custom' })
    fireEvent.pointerEnter(trigger)
    fireEvent.focus(trigger)

    const content = await screen.findByText('Detailed card')
    const popup = content.closest('[data-slot="tooltip-content"]')
    expect(popup).toBeInTheDocument()

    expect(popup?.className).toContain('w-64')
    expect(popup?.className).toContain('p-3')
    expect(popup?.className).toContain('bg-popover')
    expect(popup?.className).toContain('border-border')
  })
})
