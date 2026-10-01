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
import type { Row } from '@tanstack/react-table'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useCanEditModelPricing } from '@/features/model-pricing/api'

import { handleToggleModelStatus, isModelEnabled } from '../lib'
import type { Model } from '../types'
import { ModelDeleteDialog } from './dialogs/model-delete-dialog'
import { useModels } from './models-provider'

interface DataTableRowActionsProps {
  row: Row<Model>
}

export function DataTableRowActions({ row }: DataTableRowActionsProps) {
  const { t } = useTranslation()
  const canPrice = useCanEditModelPricing()
  const model = row.original
  const { setOpen, setCurrentRow } = useModels()
  const queryClient = useQueryClient()
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)

  const isEnabled = isModelEnabled(model)
  // A model that only exists on a channel has no metadata record yet, so there
  // is nothing to hide from the model square or to delete.
  const hasMetadata = model.id > 0

  return (
    <div className='grid w-full grid-cols-2 gap-1 [&>button]:min-w-0 [&>button]:shrink'>
      <Button
        variant='ghost'
        size='sm'
        onClick={() => {
          setCurrentRow(model)
          setOpen('update-model')
        }}
      >
        <span className='truncate'>{t('Model info')}</span>
      </Button>

      {canPrice && (
        <Button
          variant='ghost'
          size='sm'
          onClick={() => {
            setCurrentRow(model)
            setOpen('price-model')
          }}
        >
          <span className='truncate'>{t('Price')}</span>
        </Button>
      )}

      <Button
        variant='ghost'
        size='sm'
        disabled={!hasMetadata}
        onClick={() => {
          handleToggleModelStatus(model.id, model.status, queryClient)
        }}
      >
        <span className='truncate'>{isEnabled ? t('Hide') : t('Show')}</span>
      </Button>

      <Button
        variant='ghost'
        size='sm'
        className='text-destructive hover:text-destructive'
        disabled={!hasMetadata}
        onClick={() => setDeleteConfirmOpen(true)}
      >
        <span className='truncate'>{t('Delete')}</span>
      </Button>

      {deleteConfirmOpen && (
        <ModelDeleteDialog
          models={[model]}
          onClose={() => setDeleteConfirmOpen(false)}
        />
      )}
    </div>
  )
}
