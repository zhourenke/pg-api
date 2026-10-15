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
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  _resetInstalledForTesting,
  BUILD_CHANNEL_TAG,
  BUILD_REV_PREFIX,
  computeBuildRevision,
  getBuildRevision,
  installBuildMetadata,
  LS_REVISION_KEY,
} from '@/lib/build-metadata'

describe('build-metadata', () => {
  beforeEach(() => {
    _resetInstalledForTesting()
    document.documentElement.removeAttribute('data-build-rev')
    document.documentElement.removeAttribute('data-app-channel')
    document.documentElement.style.removeProperty('--app-build-rev')
    const existingMeta = document.querySelectorAll('meta[name="build-id"]')
    for (const m of existingMeta) {
      m.remove()
    }
    try {
      window.localStorage.removeItem(LS_REVISION_KEY)
    } catch {
      // ignore
    }
    try {
      delete (window as { __APP_BUILD__?: unknown }).__APP_BUILD__
    } catch {
      // ignore
    }
  })

  afterEach(() => {
    _resetInstalledForTesting()
  })

  describe('computeBuildRevision', () => {
    it('formats revision with given version and channel tag', () => {
      expect(computeBuildRevision('1.2.3')).toBe(
        `${BUILD_REV_PREFIX}.1.2.3.${BUILD_CHANNEL_TAG}`
      )
      expect(computeBuildRevision('2.0.0-rc.1')).toBe(
        `${BUILD_REV_PREFIX}.2.0.0-rc.1.${BUILD_CHANNEL_TAG}`
      )
    })

    it('falls back to 0000 when version is empty', () => {
      expect(computeBuildRevision('')).toBe(
        `${BUILD_REV_PREFIX}.0000.${BUILD_CHANNEL_TAG}`
      )
    })

    it('returns valid formatted revision when called without arguments', () => {
      const rev = computeBuildRevision()
      expect(rev.startsWith(`${BUILD_REV_PREFIX}.`)).toBe(true)
      expect(rev.endsWith(`.${BUILD_CHANNEL_TAG}`)).toBe(true)
    })
  })

  describe('getBuildRevision', () => {
    it('returns computeBuildRevision when metadata is not yet installed', () => {
      expect(getBuildRevision()).toBe(computeBuildRevision())
    })

    it('returns installed window.__APP_BUILD__.rev when installed', () => {
      installBuildMetadata()
      expect(window.__APP_BUILD__).toBeDefined()
      expect(getBuildRevision()).toBe(window.__APP_BUILD__?.rev)
    })
  })

  describe('installBuildMetadata', () => {
    it('populates window descriptor, DOM attributes, meta tag, CSS property and localStorage', () => {
      installBuildMetadata()

      const rev = getBuildRevision()
      expect(window.__APP_BUILD__).toEqual({
        rev,
        ch: BUILD_CHANNEL_TAG,
        at: expect.any(Number),
      })

      const html = document.documentElement
      expect(html.getAttribute('data-build-rev')).toBe(rev)
      expect(html.getAttribute('data-app-channel')).toBe(BUILD_CHANNEL_TAG)
      expect(html.style.getPropertyValue('--app-build-rev')).toBe(`'${rev}'`)

      const meta = document.querySelector<HTMLMetaElement>(
        'meta[name="build-id"]'
      )
      expect(meta).not.toBeNull()
      expect(meta?.getAttribute('content')).toBe(rev)

      expect(window.localStorage.getItem(LS_REVISION_KEY)).toBe(rev)
    })

    it('is idempotent on subsequent calls', () => {
      installBuildMetadata()
      const firstCallTime = window.__APP_BUILD__?.at

      installBuildMetadata()
      expect(window.__APP_BUILD__?.at).toBe(firstCallTime)

      const metaTags = document.querySelectorAll('meta[name="build-id"]')
      expect(metaTags.length).toBe(1)
    })
  })
})
