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

it('names the expiry column from the shared 过期时间 copy', async () => {
  await act(async () => {
    i18n.addResourceBundle('zhCN', 'translation', zhCN.translation, true, true)
    await i18n.changeLanguage('zhCN')
  })

  const { result } = renderHook(() => useRedemptionsColumns())
  const column = result.current.find(
    (candidate) =>
      'accessorKey' in candidate && candidate.accessorKey === 'expired_time'
  )

  // 兑换码与【密钥】两个页面共用 `Expiration Time`（两个页面的表单字段与审计日志
  // 字段名也用它），与「创建时间」成对；为只改兑换码而分出去的 `Expires on`
  // 与旧列头 `Expires` 都已删除，避免同一列在两页出现两个名字。
  expect(column?.header).toBe(zhCN.translation['Expiration Time'])
  expect(zhCN.translation['Expiration Time']).toBe('过期时间')
  const keys = Object.keys(zhCN.translation)
  expect(keys).not.toContain('Expires')
  expect(keys).not.toContain('Expires on')
})
