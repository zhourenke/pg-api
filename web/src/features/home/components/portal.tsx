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
import { Link } from '@tanstack/react-router'
import { ArrowRight, BarChart3, BookOpen, Info, LayoutGrid } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useAuthRequiredPrompt } from '@/components/layout/components/auth-required-dialog'
import { Button } from '@/components/ui/button'
import { IconBadge, type IconBadgeTone } from '@/components/ui/icon-badge'
import { useSystemConfig } from '@/hooks/use-system-config'
import { useSiteNav } from '@/hooks/use-top-nav-links'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

/** Icon + tone per site navigation target, keyed by destination. */
const ENTRY_VISUALS: Record<
  string,
  { icon: React.ElementType; tone: IconBadgeTone; description: string }
> = {
  '/pricing': {
    icon: LayoutGrid,
    tone: 'info',
    description: 'Browse models and pricing.',
  },
  '/rankings': {
    icon: BarChart3,
    tone: 'chart-2',
    description: 'Live usage leaderboard.',
  },
  '/about': {
    icon: Info,
    tone: 'neutral',
    description: 'About this deployment.',
  },
}

const DOCS_VISUAL = {
  icon: BookOpen,
  tone: 'neutral' as IconBadgeTone,
  description: 'Read the documentation.',
}

function entryVisual(href: string) {
  return ENTRY_VISUALS[href] ?? DOCS_VISUAL
}

/**
 * Home portal.
 *
 * Replaces the old marketing landing page: no feature grid, no invented
 * statistics, no call-to-action copy. It carries exactly the two jobs the home
 * page still has — get a signed-in visitor into the console, and expose the
 * cross-section pages that the console header hides on narrow viewports.
 *
 * Both halves follow the admin's Header navigation switches through
 * `useSiteNav()`, so disabling a module in System Settings removes it here too.
 */
export function Portal() {
  const { t } = useTranslation()
  const { systemName, logo } = useSystemConfig()
  const { auth } = useAuthStore()
  const isAuthenticated = !!auth.user
  const { showConsole, links } = useSiteNav()
  const { requestSignIn, authPromptDialog } = useAuthRequiredPrompt()

  const primaryHref = isAuthenticated ? '/dashboard' : '/sign-in'
  const primaryLabel = isAuthenticated ? t('Go to Console') : t('Sign in')

  return (
    <div className='relative flex flex-1 flex-col overflow-x-clip'>
      {/* Faint grid, the only decoration left. */}
      <div
        aria-hidden
        className='pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(to_right,var(--border)_1px,transparent_1px),linear-gradient(to_bottom,var(--border)_1px,transparent_1px)] [mask-image:radial-gradient(ellipse_50%_45%_at_50%_38%,black_10%,transparent_100%)] bg-[size:4rem_4rem] opacity-[0.06]'
      />

      <main className='flex flex-1 items-center justify-center px-6 pt-24 pb-16'>
        <div className='flex w-full max-w-xl flex-col items-center text-center'>
          <div className='border-border/50 bg-background/70 flex size-14 items-center justify-center overflow-hidden rounded-2xl border shadow-xs backdrop-blur'>
            <img
              src={logo}
              alt={t('Logo')}
              className='size-full object-contain'
            />
          </div>

          <h1 className='mt-6 text-2xl font-bold tracking-tight sm:text-3xl'>
            {systemName}
          </h1>
          <p className='text-muted-foreground mt-2 text-sm'>
            {t('Unified AI model API gateway')}
          </p>

          {showConsole && (
            <Button
              size='lg'
              className='group mt-8 h-10 rounded-lg px-5 text-sm font-medium'
              render={<Link to={primaryHref} />}
            >
              {primaryLabel}
              <ArrowRight className='ml-1.5 size-4 transition-transform duration-200 group-hover:translate-x-0.5' />
            </Button>
          )}

          {links.length > 0 && (
            <nav
              aria-label={t('Site navigation')}
              className='mt-10 grid w-full gap-2 sm:grid-cols-2'
            >
              {links.map((link) => {
                const visual = entryVisual(link.href)
                const Icon = visual.icon
                const cardClassName = cn(
                  'group border-border/50 bg-background/60 hover:border-border hover:bg-muted/40',
                  'flex items-center gap-3 rounded-xl border px-4 py-3 text-left shadow-xs backdrop-blur',
                  'focus-visible:ring-ring/40 transition-colors outline-none focus-visible:ring-2'
                )
                const content = (
                  <>
                    <IconBadge tone={visual.tone} size='md'>
                      <Icon />
                    </IconBadge>
                    <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
                      <span className='truncate text-sm font-medium'>
                        {t(link.title)}
                      </span>
                      <span className='text-muted-foreground truncate text-xs'>
                        {t(visual.description)}
                      </span>
                    </span>
                    <ArrowRight className='text-muted-foreground/60 group-hover:text-foreground size-4 shrink-0 transition-colors' />
                  </>
                )

                if (link.external) {
                  return (
                    <a
                      key={`${link.title}:${link.href}`}
                      href={link.href}
                      target='_blank'
                      rel='noopener noreferrer'
                      className={cardClassName}
                    >
                      {content}
                    </a>
                  )
                }

                if (link.requiresAuth) {
                  return (
                    <button
                      key={`${link.title}:${link.href}`}
                      type='button'
                      onClick={() => requestSignIn(link)}
                      className={cardClassName}
                    >
                      {content}
                    </button>
                  )
                }

                return (
                  <Link
                    key={`${link.title}:${link.href}`}
                    to={link.href}
                    className={cardClassName}
                  >
                    {content}
                  </Link>
                )
              })}
            </nav>
          )}
        </div>
      </main>

      {authPromptDialog}
    </div>
  )
}
