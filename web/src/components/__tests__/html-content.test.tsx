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

import { HtmlContent } from '../html-content'

// A leading `<style>` is dropped for an unrelated reason: DOMPurify returns
// `body.innerHTML` and the HTML parser parks a leading style element in `<head>`.
// The cases below therefore put the element after other markup, which is what a
// real footer looks like and what actually reaches the document.
it('drops a style element that follows markup so the content cannot restyle the document', () => {
  const { container } = render(
    <HtmlContent
      content={
        '<p>footer probe</p>' + '<style>body{outline:3px solid red}</style>'
      }
    />
  )

  expect(container.querySelector('style')).toBeNull()
  expect(screen.getByText('footer probe')).toBeVisible()
})

it('drops a nested style element and a stylesheet link', () => {
  const { container } = render(
    <HtmlContent
      content={
        '<div>' +
        '<style>.probe{display:none}</style>' +
        '<link rel="stylesheet" href="/probe.css">' +
        '<span>nested probe</span>' +
        '</div>'
      }
    />
  )

  expect(container.querySelector('style')).toBeNull()
  expect(container.querySelector('link')).toBeNull()
  expect(screen.getByText('nested probe')).toBeVisible()
})

it('keeps ordinary markup and still strips executable content', () => {
  const { container } = render(
    <HtmlContent
      content={
        '<b>bold</b>' +
        '<a href="https://example.com/docs">link</a>' +
        '<script>window.__htmlContentProbe = 1</script>'
      }
    />
  )

  expect(screen.getByText('bold')).toBeVisible()
  expect(screen.getByRole('link', { name: 'link' })).toHaveAttribute(
    'href',
    'https://example.com/docs'
  )
  expect(container.querySelector('script')).toBeNull()
})

it('keeps a style element scoped inside the isolated shadow root', () => {
  const { container } = render(
    <HtmlContent
      variant='isolated'
      content={
        '<span class="probe">isolated probe</span>' +
        '<style>.probe{color:rgb(1,2,3)}</style>'
      }
    />
  )

  const host = container.firstElementChild as HTMLElement | null
  const shadowRoot = host?.shadowRoot ?? null

  expect(shadowRoot).not.toBeNull()
  expect(
    [...(shadowRoot?.querySelectorAll('style') ?? [])].some((node) =>
      node.textContent?.includes('.probe{color:rgb(1,2,3)}')
    )
  ).toBe(true)
  expect(shadowRoot?.querySelector('span.probe')?.textContent).toBe(
    'isolated probe'
  )
  expect(document.querySelector('style')).toBeNull()
})
