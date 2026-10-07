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
import { expect, it } from 'vitest'

import zh from '@/i18n/locales/zh.json'
import { STATIC_I18N_KEYS } from '@/i18n/static-keys'

const keys = zh.translation as Record<string, string>

it('drops the per-token and per-request deprecated keys but keeps the Deprecated badge', () => {
  // GUI 里早已没有计费类型列，所以这两条「按 Token（已弃用）」「按次（已弃用）」
  // 没有任何渲染路径；清掉它们时不能连带删掉真正的废弃徽章文案——【渠道】的
  // 旧集成方式与【使用日志】的历史类型都在用 `Deprecated`。
  expect(keys['Per-token (deprecated)']).toBeUndefined()
  expect(keys['Per-request (deprecated)']).toBeUndefined()
  expect(keys['Deprecated']).toBe('已弃用')
  expect(STATIC_I18N_KEYS).not.toContain('Per-token (deprecated)')
  expect(STATIC_I18N_KEYS).not.toContain('Per-request (deprecated)')
})

it('keeps every static key resolvable in the shipped locale', () => {
  // `STATIC_I18N_KEYS` 存在的意义就是给不进 `t('...')` 字面量的键留一份登记，所以
  // 里面的每一条都必须在词条里有值；本次清理如果只删词条不删登记，这一条会红。
  const unresolved = STATIC_I18N_KEYS.filter((key) => keys[key] === undefined)

  expect(unresolved).toEqual([])
})
