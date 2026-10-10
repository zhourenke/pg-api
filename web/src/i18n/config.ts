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
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import zhCN from './locales/zh.json'

/*
 * The interface ships in Simplified Chinese only, so `zh.json` is both the key
 * base and the only resource: its keys are the English source strings passed to
 * `t('...')` at the call sites, and its values are the Chinese copy.
 *
 * The init stays guarded so importing this module twice — or importing it under
 * tests, where the harness has already configured the shared instance — cannot
 * replace the active options or resources.
 */
if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: { zhCN },
    lng: 'zhCN',
    fallbackLng: 'zhCN',
    supportedLngs: ['zhCN'],
    load: 'currentOnly',
    nsSeparator: false, // Allow literal colons in keys (e.g., URLs, labels)
    debug: import.meta.env.DEV,
    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
  })
}
