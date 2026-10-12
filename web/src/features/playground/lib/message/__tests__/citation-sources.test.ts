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
import { describe, expect, test } from 'vitest'

import type {
  ChatCompletionResponse,
  Message,
  MessageAnnotation,
} from '../../../types'
import {
  applyMessageSources,
  collectMessageSources,
  mergeMessageSources,
} from '../message-source-utils'
import { applyChatCompletionResponse } from '../message-streaming-utils'

const assistantMessage: Message = {
  key: 'msg-1',
  from: 'assistant',
  versions: [{ id: 'v1', content: 'answer' }],
  status: 'complete',
}

function urlCitation(url: string, title?: string): MessageAnnotation {
  return { type: 'url_citation', url_citation: { url, title } }
}

describe('reading citations out of annotations', () => {
  test('maps a titled url_citation into a source', () => {
    expect(
      collectMessageSources([urlCitation('https://example.com/a', 'A')])
    ).toEqual([{ href: 'https://example.com/a', title: 'A' }])
  })

  test('labels a citation without a title by its url', () => {
    expect(
      collectMessageSources([urlCitation('https://example.com/a')])
    ).toEqual([
      { href: 'https://example.com/a', title: 'https://example.com/a' },
    ])
  })

  test('ignores other annotation kinds and citations without a url', () => {
    expect(
      collectMessageSources([
        { type: 'file_citation', url_citation: { url: 'https://x.test' } },
        { type: 'url_citation' },
        { type: 'url_citation', url_citation: { url: '   ' } },
      ])
    ).toEqual([])
  })

  test('keeps one entry when a response repeats the same citation', () => {
    const citation = urlCitation('https://example.com/a', 'A')

    expect(collectMessageSources([citation, citation])).toEqual([
      { href: 'https://example.com/a', title: 'A' },
    ])
  })
})

describe('merging citations into a message', () => {
  test('appends a citation the message does not show yet', () => {
    expect(
      mergeMessageSources(
        [{ href: 'https://example.com/a', title: 'A' }],
        [{ href: 'https://example.com/b', title: 'B' }]
      )
    ).toEqual([
      { href: 'https://example.com/a', title: 'A' },
      { href: 'https://example.com/b', title: 'B' },
    ])
  })

  test('does not repeat a citation the message already shows', () => {
    const current = [{ href: 'https://example.com/a', title: 'A' }]

    expect(mergeMessageSources(current, current)).toEqual(current)
  })

  test('attaches a chunk citation to the message', () => {
    expect(
      applyMessageSources(assistantMessage, [
        urlCitation('https://example.com/a', 'A'),
      ]).sources
    ).toEqual([{ href: 'https://example.com/a', title: 'A' }])
  })

  test('returns the same message when a chunk cites nothing usable', () => {
    const message = applyMessageSources(assistantMessage, [
      { type: 'file_citation' },
    ])

    expect(message).toBe(assistantMessage)
    expect(message.sources).toBeUndefined()
  })
})

describe('citations of a non-streaming answer', () => {
  function completionWith(
    annotations: MessageAnnotation[]
  ): ChatCompletionResponse {
    return {
      id: 'chatcmpl-1',
      object: 'chat.completion',
      created: 1,
      model: 'test-model',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'answer', annotations },
          finish_reason: 'stop',
        },
      ],
    }
  }

  test('become the sources of the finalized message', () => {
    const applied = applyChatCompletionResponse(
      assistantMessage,
      completionWith([urlCitation('https://example.com/a', 'A')])
    )

    expect(applied?.sources).toEqual([
      { href: 'https://example.com/a', title: 'A' },
    ])
    expect(applied?.status).toBe('complete')
  })

  test('leave a message without citations unchanged', () => {
    const applied = applyChatCompletionResponse(
      assistantMessage,
      completionWith([])
    )

    expect(applied?.sources).toBeUndefined()
  })
})
