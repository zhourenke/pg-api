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

import { StaticRowActions } from '@/components/data-table/static/static-row-actions'
import { StatusBadge } from '@/components/status-badge'
import { ModelPriceCell } from '@/features/pricing/components/model-price-cell'

import {
  isBasePricingUnset,
  toPriceCellModel,
  type ModelRow,
} from './model-pricing-snapshots'

/**
 * 一行价格的身份：模型名与冲突标记。表格的名称列与卡片的标题行共用这一块，
 * 字号由外面给（表格交给共享表格，卡片写 `text-sm`）。
 */
export function ModelIdentity(props: { model: ModelRow }) {
  const { t } = useTranslation()

  return (
    <div className='flex max-w-full min-w-0 items-center gap-2 font-medium'>
      <span className='min-w-0 truncate'>{props.model.name}</span>
      {props.model.hasConflict && (
        <StatusBadge
          label={t('Conflict')}
          variant='danger'
          copyable={false}
          className='shrink-0'
        />
      )}
    </div>
  )
}

/**
 * 窄屏卡片：大字模型名在左、删除按钮在右，价格小字另起一行占满整行。
 *
 * 共享的卡片内容（`CardRowContent`）按列 meta 排布，落在这张表上是「标签在
 * 左、值在右」的三行：模型名、价格概要、删除各占一行，价格还要与它的标签抢
 * 同一行，窄屏下先被省略号截断。表格自己提供 `renderCard` 就是给这种版式的
 * 口子（渠道卡片同样在用），所以这里自己排：标题行留给身份与操作，价格独占
 * 下一行的整卡宽度。列本身不动，所以宽屏表格与这版式无关。
 *
 * 宽屏那行还可以直接点开定价面板（`renderRow` 的 `onClick`），窄屏换掉整行之后
 * 这句话没有对应物——卡片里只剩删除按钮——所以由整卡自己接住：给了 `onOpen`
 * 就点得动，判断沿用宽屏那一句，落在按钮上只做按钮的事。
 */
export function ModelRatioCard(props: {
  model: ModelRow
  onDelete: (name: string) => void
  /** 整卡可点打开的定价面板；省略时卡片不可点。 */
  onOpen?: () => void
  /** 未设置价格模型页：只认出模型，没有价格也没有删除。 */
  identityOnly?: boolean
}) {
  const { t } = useTranslation()

  return (
    <div
      data-slot='model-ratio-card'
      className='flex min-w-0 items-start justify-between gap-2'
      onClick={(event) => {
        if (!props.onOpen) return
        const target = event.target as HTMLElement
        if (target.closest('button, [role="checkbox"]')) return
        props.onOpen()
      }}
    >
      <div className='min-w-0 flex-1 text-sm'>
        <ModelIdentity model={props.model} />
        {!props.identityOnly && (
          <div className='mt-1 min-w-0'>
            <ModelPriceCell model={toPriceCellModel(props.model)} />
          </div>
        )}
      </div>
      {!props.identityOnly && (
        <div className='shrink-0'>
          <StaticRowActions
            deleteLabel={t('Delete')}
            onDelete={() => props.onDelete(props.model.name)}
            deleteDisabled={isBasePricingUnset(
              props.model.draft ?? props.model.saved ?? props.model
            )}
          />
        </div>
      )}
    </div>
  )
}
