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
import type { TFunction } from 'i18next'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { useStatus } from '@/hooks/use-status'
import {
  parseHeaderNavModulesFromStatus,
  type HeaderNavModules,
} from '@/lib/nav-modules'
import { useAuthStore } from '@/stores/auth-store'

export type TopNavLink = {
  title: string
  href: string
  disabled?: boolean
  requiresAuth?: boolean
  external?: boolean
}

/**
 * Stable identity for a header navigation entry.
 *
 * Callers that need to reason about *which* entry they got (the home portal
 * drops `home`/`console`, the command palette lists only the cross-section
 * pages) match on this id instead of on the translated title.
 */
type SiteNavId = 'home' | 'console' | 'pricing' | 'rankings' | 'docs' | 'about'

type NavEntry = { id: SiteNavId; link: TopNavLink }

/**
 * Build the header navigation entries from `/api/status` module switches.
 *
 * Single source of truth for every surface that renders site navigation: the
 * public header, the narrow-viewport top-nav dropdown, the home portal and the
 * command palette. Adding an entry here reaches all of them.
 *
 * `docs` is skipped when no documentation link is configured: there is no
 * local `/docs` route, so falling back to it produced a dead entry.
 */
function buildNavEntries(
  t: TFunction,
  modules: HeaderNavModules,
  isAuthed: boolean,
  docsLink: string | undefined
): NavEntry[] {
  const entries: NavEntry[] = []

  if (modules.home !== false) {
    entries.push({ id: 'home', link: { title: t('Home'), href: '/' } })
  }

  if (modules.console !== false) {
    entries.push({
      id: 'console',
      link: { title: t('Console'), href: '/dashboard' },
    })
  }

  const pricing = modules.pricing
  if (pricing && typeof pricing === 'object' && pricing.enabled) {
    entries.push({
      id: 'pricing',
      link: {
        title: t('Model Square'),
        href: '/pricing',
        requiresAuth: pricing.requireAuth && !isAuthed,
      },
    })
  }

  const rankings = modules.rankings
  if (rankings && typeof rankings === 'object' && rankings.enabled) {
    entries.push({
      id: 'rankings',
      link: {
        title: t('Rankings'),
        href: '/rankings',
        requiresAuth: rankings.requireAuth && !isAuthed,
      },
    })
  }

  if (modules.docs !== false && docsLink) {
    entries.push({
      id: 'docs',
      link: { title: t('Docs'), href: docsLink, external: true },
    })
  }

  if (modules.about !== false) {
    entries.push({ id: 'about', link: { title: t('About'), href: '/about' } })
  }

  return entries
}

/** Read the backend `HeaderNavModules` switches plus auth state once. */
function useNavSource() {
  const { t } = useTranslation()
  const { status } = useStatus()
  const { auth } = useAuthStore()

  const modules = useMemo(
    () =>
      parseHeaderNavModulesFromStatus(status as Record<string, unknown> | null),
    [status]
  )
  const docsLink = status?.docs_link as string | undefined
  const isAuthed = !!auth?.user

  return { t, modules, docsLink, isAuthed }
}

/**
 * Generate top navigation links based on HeaderNavModules configuration from backend /api/status
 * Backend format example (stringified JSON):
 * {
 *   home: true,
 *   console: true,
 *   pricing: { enabled: true, requireAuth: false },
 *   rankings: { enabled: true, requireAuth: false },
 *   docs: true,
 *   about: true
 * }
 */
export function useTopNavLinks(): TopNavLink[] {
  const { t, modules, docsLink, isAuthed } = useNavSource()

  return useMemo(
    () => buildNavEntries(t, modules, isAuthed, docsLink).map((e) => e.link),
    [t, modules, isAuthed, docsLink]
  )
}

/**
 * The cross-section pages a visitor can reach from outside the console:
 * everything the header lists except `home` (the current page) and `console`
 * (promoted to the portal's primary button).
 *
 * `showConsole` reports whether the console entry itself is enabled, so the
 * portal can drop its primary button instead of linking somewhere that
 * redirects away.
 */
export function useSiteNav(): { showConsole: boolean; links: TopNavLink[] } {
  const { t, modules, docsLink, isAuthed } = useNavSource()

  return useMemo(() => {
    const entries = buildNavEntries(t, modules, isAuthed, docsLink)
    return {
      showConsole: entries.some((entry) => entry.id === 'console'),
      links: entries
        .filter((entry) => entry.id !== 'home' && entry.id !== 'console')
        .map((entry) => entry.link),
    }
  }, [t, modules, isAuthed, docsLink])
}
