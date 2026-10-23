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
import { useQueryClient } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SectionPageLayout } from '@/components/layout'
import { ViewScopeToggle } from '@/components/view-scope-toggle'
import { getUserProfile } from '@/features/profile/api'
import {
  ADMIN_PERMISSION_RESOURCES,
  ADMIN_PERMISSION_ACTIONS,
  hasPermission,
} from '@/lib/admin-permissions'
import { ROLE } from '@/lib/roles'
import { isTimeWindowStale, resolveTimeWindow } from '@/lib/time-window'
import { useAuthStore } from '@/stores/auth-store'

import type { AuditFilters } from './api'
import { AuditLogViewer } from './components/audit-log-viewer'
import {
  auditFiltersFromSearch,
  buildAuditSearchParams,
} from './lib/search-params'

const route = getRouteApi('/_authenticated/usage-logs/audit')

export function AuditLogs() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const searchParams = route.useSearch()
  const user = useAuthStore((state) => state.auth.user)
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<'all' | 'self'>('all')
  const [accessRevoked, setAccessRevoked] = useState(false)
  // The address bar is the single source of truth for the filters, so a reload
  // or a shared link reopens the same view and a chosen window keeps its name.
  const filters = useMemo(
    () => auditFiltersFromSearch(searchParams),
    [searchParams]
  )
  const canReadAll =
    !!user &&
    user.role >= ROLE.ADMIN &&
    hasPermission(
      user,
      ADMIN_PERMISSION_RESOURCES.AUDIT,
      ADMIN_PERMISSION_ACTIONS.READ
    )
  const effectiveScope = canReadAll && !accessRevoked ? scope : 'self'
  const userId = user?.id
  const handleAccessDenied = useCallback(async () => {
    setAccessRevoked(true)
    setScope('self')
    const current = useAuthStore.getState().auth.user
    if (current && current.id === userId) {
      useAuthStore.getState().auth.setUser({
        ...current,
        permissions: {
          ...current.permissions,
          admin_permissions: {
            ...current.permissions?.admin_permissions,
            audit: { read: false },
          },
        },
      })
    }
    await queryClient.cancelQueries({ queryKey: ['audit', userId, 'all'] })
    queryClient.removeQueries({ queryKey: ['audit', userId, 'all'] })
    try {
      const profile = await getUserProfile()
      const latest = useAuthStore.getState().auth.user
      if (
        profile.success &&
        profile.data &&
        latest &&
        profile.data.id === userId &&
        latest.id === userId
      ) {
        useAuthStore.getState().auth.setUser({
          ...latest,
          role: profile.data.role,
          permissions: profile.data.permissions,
        })
      }
    } catch {
      // Keep the denied scope closed when refreshing capabilities fails.
    }
  }, [queryClient, userId])
  const handleFiltersChange = useCallback(
    (next: AuditFilters) => {
      navigate({
        to: '/usage-logs/audit',
        search: buildAuditSearchParams(next),
      })
    },
    [navigate]
  )

  // A calendar window ("this week") is stored in the address bar as bounds that
  // stop matching once local midnight passes, so resolve it again on the way in;
  // a rolling window's stored bounds are simply refreshed. Once they match, the
  // effect stops rewriting the URL.
  useEffect(() => {
    const { preset, start_timestamp: start, end_timestamp: end } = filters
    if (!preset || start === undefined || end === undefined) return
    if (!isTimeWindowStale(preset, { start, end })) return

    const fresh = resolveTimeWindow(preset)
    navigate({
      to: '/usage-logs/audit',
      search: {
        ...buildAuditSearchParams(filters),
        startTime: fresh.start,
        endTime: fresh.end,
        preset,
      },
      replace: true,
    })
  }, [filters, navigate])

  return (
    <SectionPageLayout fixedContent>
      <SectionPageLayout.Title>{t('Audit Logs')}</SectionPageLayout.Title>
      <SectionPageLayout.Actions>
        {canReadAll && !accessRevoked && (
          <ViewScopeToggle value={scope} onValueChange={setScope} />
        )}
      </SectionPageLayout.Actions>
      <SectionPageLayout.Content>
        <div className='flex h-full min-h-0 flex-col gap-3'>
          {accessRevoked && (
            <p role='status' className='text-muted-foreground shrink-0 text-xs'>
              {t('Audit access changed. Showing only your records.')}
            </p>
          )}
          <div className='min-h-0 flex-1'>
            <AuditLogViewer
              scope={effectiveScope}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              onAccessDenied={handleAccessDenied}
            />
          </div>
        </div>
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
