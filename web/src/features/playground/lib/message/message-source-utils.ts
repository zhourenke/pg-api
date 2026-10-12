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
import type {
  Message,
  MessageAnnotation,
  MessageSource,
  UrlCitation,
} from '../../types'

const URL_CITATION_TYPE = 'url_citation'

function toMessageSource(
  citation: UrlCitation | undefined
): MessageSource | null {
  const href = citation?.url?.trim()

  if (!href) {
    return null
  }

  return { href, title: citation?.title?.trim() || href }
}

function hasSource(
  sources: MessageSource[],
  candidate: MessageSource
): boolean {
  return sources.some(
    (source) =>
      source.href === candidate.href && source.title === candidate.title
  )
}

/**
 * Reads the annotations one response or stream chunk carries into the sources a
 * message displays. Only the url_citation kind is shown: an upstream may attach
 * other annotation kinds this surface has nothing to render, and a citation
 * without a usable URL would be a dead link. A citation without a title keeps
 * the URL as its label so the entry stays readable.
 */
export function collectMessageSources(
  annotations?: MessageAnnotation[]
): MessageSource[] {
  if (!Array.isArray(annotations)) {
    return []
  }

  const sources: MessageSource[] = []

  for (const annotation of annotations) {
    if (annotation?.type !== URL_CITATION_TYPE) {
      continue
    }

    const source = toMessageSource(annotation.url_citation)

    if (source && !hasSource(sources, source)) {
      sources.push(source)
    }
  }

  return sources
}

/**
 * Appends newly cited sources to the ones a message already shows without
 * repeating a citation twice: a stream repeats the same citation on every chunk
 * that carries it, and the same merge runs again after a reload of the stored
 * conversation.
 */
export function mergeMessageSources(
  current: MessageSource[] | undefined,
  incoming: MessageSource[]
): MessageSource[] {
  const merged = current ? [...current] : []

  for (const source of incoming) {
    if (!hasSource(merged, source)) {
      merged.push(source)
    }
  }

  return merged
}

/**
 * Attaches the annotations of one response or stream chunk to a message. The
 * message is returned unchanged when the chunk cites nothing, so a stream that
 * never cites does not re-render the message on every chunk.
 */
export function applyMessageSources(
  message: Message,
  annotations?: MessageAnnotation[]
): Message {
  const incoming = collectMessageSources(annotations)

  if (incoming.length === 0) {
    return message
  }

  return { ...message, sources: mergeMessageSources(message.sources, incoming) }
}
