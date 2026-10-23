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
import { useTranslation } from 'react-i18next'

import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

/**
 * "All / Only mine" scope switch that every admin-visible page puts in its
 * title bar. `all` means the admin view of the platform, `self` means the page
 * behaves exactly like it does for a regular user, so pages can key their data
 * source and admin-only controls off the selected scope rather than off the
 * account's role.
 */
export type ViewScope = 'all' | 'self'

interface ViewScopeToggleProps {
  value: ViewScope
  onValueChange: (scope: ViewScope) => void
}

export function ViewScopeToggle(props: ViewScopeToggleProps) {
  const { t } = useTranslation()

  return (
    <Tabs
      value={props.value}
      onValueChange={(value) =>
        props.onValueChange(value === 'all' ? 'all' : 'self')
      }
    >
      <TabsList aria-label={t('View scope')}>
        <TabsTrigger value='all'>{t('All')}</TabsTrigger>
        <TabsTrigger value='self'>{t('Only Mine')}</TabsTrigger>
      </TabsList>
    </Tabs>
  )
}
