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
import { act, renderHook } from '@testing-library/react'
import i18n from 'i18next'
import { expect, it } from 'vitest'

import zhCN from '@/i18n/locales/zh.json'

import { useRedemptionsColumns } from '../redemptions-columns'

it('names the expiry column 过期日期 without renaming the API key page copy', async () => {
  await act(async () => {
    i18n.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
    await i18n.changeLanguage('zhCN')
  })

  const { result } = renderHook(() => useRedemptionsColumns())
  const column = result.current.find(
    (candidate) =>
      'accessorKey' in candidate && candidate.accessorKey === 'expired_time'
  )

  // 【密钥】页的同一个日期列读的是 `Expires`（「过期」），兑换码要的是「过期
  // 日期」，所以这一列改读自己的键；两个页面因此可以各说各的。
  expect(column?.header).toBe('过期日期')
  expect(zhCN.translation['Expires']).toBe('过期')
})
