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

import { StatusBadge, type StatusVariant } from '@/components/status-badge'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from '@/components/ui/popover'

import type { Model } from '../types'

export function ModelSquareStatus(props: { model: Model; detail?: boolean }) {
  const { t } = useTranslation()
  let label: string
  let description: string
  let variant: StatusVariant = 'neutral'
  switch (props.model.square_state) {
    case 'visible':
      label = t('Displayed')
      description = t(
        'Visible only to users with access to the model’s groups.'
      )
      variant = 'success'
      break
    case 'hidden':
      label = t('Listing hidden')
      description = t('Hidden from the model square by metadata policy.')
      break
    case 'partial':
      label = t('Partly shown')
      description = t(
        'Some matching models are hidden or have no available channel.'
      )
      variant = 'warning'
      break
    case 'unavailable': {
      label = t('Unavailable')
      variant = 'warning'
      const causes: string[] = []
      // 未配置价格的模型无法转发，模型广场也不会列出它；这是与「没有可用渠道」
      // 不同的原因，管理员要配的是价格而不是渠道，所以单独说一句。
      if (props.model.has_billing_config === false) {
        causes.push(
          t(
            'No price is configured. This model will not appear in the model square.'
          )
        )
      }
      if (props.model.configured_channel_count === 0) {
        causes.push(
          props.model.name_rule !== 0
            ? t('No configured channel models match this metadata rule.')
            : t(
                'No channel is configured. This model will not appear in the model square.'
              )
        )
      }
      if (!causes.length) {
        causes.push(
          t(
            'No channel is currently available. This model will not appear in the model square.'
          )
        )
      }
      description = causes.join(' ')
      break
    }
    default:
      return <span className='text-muted-foreground'>—</span>
  }
  const badge = (
    <StatusBadge
      variant={variant}
      label={label}
      copyable={false}
      title={undefined}
    />
  )
  if (props.detail) {
    return (
      <div className='space-y-2'>
        {badge}
        <p className='text-muted-foreground text-sm'>{description}</p>
      </div>
    )
  }
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant='ghost'
            size='sm'
            title={description}
            aria-description={description}
            className='h-auto max-w-full min-w-0 cursor-pointer border-0 p-0'
          />
        }
      >
        {badge}
      </PopoverTrigger>
      <PopoverContent
        role='dialog'
        className='max-w-[calc(100vw-2rem)] break-words whitespace-normal'
        collisionPadding={16}
      >
        <PopoverTitle>{label}</PopoverTitle>
        <PopoverDescription>{description}</PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}
