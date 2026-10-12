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
import { expect, it } from 'vitest'

import { Markdown } from '../markdown'

// A leading `<style>` is dropped for an unrelated reason: DOMPurify returns
// `body.innerHTML` and the HTML parser parks a leading style element in `<head>`.
// The element therefore has to follow other markup to reproduce the leak.
it('drops a style element that follows markup so rendered markdown cannot restyle the page', () => {
  const { container } = render(
    <Markdown>
      {'notice text\n\n<style>body{outline:3px solid red}</style>'}
    </Markdown>
  )

  expect(container.querySelector('style')).toBeNull()
  expect(screen.getByText('notice text')).toBeVisible()
})

it('keeps rendered markdown structure', () => {
  render(<Markdown>{'# Heading\n\n[link](https://example.com/docs)'}</Markdown>)

  expect(screen.getByRole('heading', { name: 'Heading' })).toBeVisible()

  const link = screen.getByRole('link', { name: 'link' })

  expect(link).toHaveAttribute('href', 'https://example.com/docs')
  expect(link).toHaveAttribute('rel', 'noopener noreferrer')
})

it('strips executable markup while keeping inline style attributes', () => {
  const { container } = render(
    <Markdown>
      {
        '<span style="color:rgb(1, 2, 3)">styled</span>\n\n<script>window.__markdownProbe = 1</script>'
      }
    </Markdown>
  )

  expect(screen.getByText('styled')).toHaveStyle({ color: 'rgb(1, 2, 3)' })
  expect(container.querySelector('script')).toBeNull()
})
