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
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'

import type { TopNavLink } from '../types'

const AUTH_PROMPT_SECONDS = 5

type AuthPromptTarget = {
  title: string
  href: string
}

/**
 * "Sign in required" prompt for navigation entries that the admin marked as
 * login-only (`pricing.requireAuth` / `rankings.requireAuth`).
 *
 * Shared by the public header and the home portal so a visitor gets the same
 * explanation and the same countdown before the redirect, instead of one
 * surface silently bouncing them to the sign-in page.
 */
export function useAuthRequiredPrompt() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [target, setTarget] = useState<AuthPromptTarget | null>(null)
  const [secondsLeft, setSecondsLeft] = useState(AUTH_PROMPT_SECONDS)

  useEffect(() => {
    if (!target) return

    const intervalId = window.setInterval(() => {
      setSecondsLeft((seconds) => Math.max(seconds - 1, 0))
    }, 1000)

    const timeoutId = window.setTimeout(() => {
      const redirect = target.href
      setTarget(null)
      navigate({ to: '/sign-in', search: { redirect } })
    }, AUTH_PROMPT_SECONDS * 1000)

    return () => {
      window.clearInterval(intervalId)
      window.clearTimeout(timeoutId)
    }
  }, [target, navigate])

  const requestSignIn = useCallback(
    (link: TopNavLink) => {
      setSecondsLeft(AUTH_PROMPT_SECONDS)
      setTarget({ title: t(link.title), href: link.href })
    },
    [t]
  )

  const closePrompt = useCallback(() => {
    setTarget(null)
    setSecondsLeft(AUTH_PROMPT_SECONDS)
  }, [])

  const navigateToSignIn = useCallback(() => {
    const redirect = target?.href || '/'
    setTarget(null)
    navigate({ to: '/sign-in', search: { redirect } })
  }, [target?.href, navigate])

  const authPromptDialog = (
    <Dialog
      open={!!target}
      onOpenChange={(open) => {
        if (!open) closePrompt()
      }}
      title={t('Sign in required')}
      description={t('Please sign in to view {{module}}.', {
        module: target?.title || '',
      })}
      contentClassName='sm:max-w-md'
      contentHeight='auto'
      footer={
        <>
          <Button variant='outline' onClick={closePrompt}>
            {t('Cancel')}
          </Button>
          <Button onClick={navigateToSignIn}>{t('Sign in now')}</Button>
        </>
      }
    >
      <div className='bg-muted/40 text-muted-foreground rounded-lg px-3 py-2 text-sm'>
        {t('Redirecting to sign in in {{seconds}} seconds.', {
          seconds: secondsLeft,
        })}
      </div>
    </Dialog>
  )

  return { requestSignIn, authPromptDialog }
}
