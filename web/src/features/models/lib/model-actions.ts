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
import type { QueryClient } from '@tanstack/react-query'
import i18next from 'i18next'
import { toast } from 'sonner'

import { handleServerError } from '@/lib/handle-server-error'

import { createModel, updateModelStatus } from '../api'
import { invalidateVendorData } from '../vendor-api'

// ============================================================================
// Model Status Actions
// ============================================================================

/**
 * Hide a model that only exists on a channel.
 *
 * Such a row is in the model square because a channel serves it and it has a
 * price; the catalog never asks for a metadata record (`FillModelSquareStates`
 * decides on availability plus billing config). So there is no display policy to
 * flip yet, and `updateModelStatus` has no row to update. Creating the record
 * with the policy already set to hidden is what takes the model out of the
 * square, and it leaves the row in the ordinary state where 展示/隐藏 toggles the
 * policy from then on.
 */
export async function handleHideChannelOnlyModel(
  modelName: string,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await createModel({
      model_name: modelName,
      name_rule: 0,
      status: 0,
    })
    if (response.success) {
      toast.success(
        i18next.t(
          'Hidden from the model square, and a metadata record was created for it.'
        )
      )
      if (queryClient) await invalidateVendorData(queryClient)
      onSuccess?.()
    } else {
      handleServerError(
        response,
        i18next.t('Failed to hide model from model square')
      )
    }
  } catch (error: unknown) {
    handleServerError(
      error,
      i18next.t('Failed to hide model from model square')
    )
  }
}

/**
 * Enable a model
 */
export async function handleEnableModel(
  id: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await updateModelStatus(id, 1)
    if (response.success) {
      toast.success(i18next.t('Model shown in model square'))
      if (queryClient) await invalidateVendorData(queryClient)
      onSuccess?.()
    } else {
      handleServerError(
        response,
        i18next.t('Failed to show model in model square')
      )
    }
  } catch (error: unknown) {
    handleServerError(error, i18next.t('Failed to show model in model square'))
  }
}

/**
 * Disable a model
 */
export async function handleDisableModel(
  id: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  try {
    const response = await updateModelStatus(id, 0)
    if (response.success) {
      toast.success(i18next.t('Model hidden from model square'))
      if (queryClient) await invalidateVendorData(queryClient)
      onSuccess?.()
    } else {
      handleServerError(
        response,
        i18next.t('Failed to hide model from model square')
      )
    }
  } catch (error: unknown) {
    handleServerError(
      error,
      i18next.t('Failed to hide model from model square')
    )
  }
}

/**
 * Toggle model status
 */
export async function handleToggleModelStatus(
  id: number,
  currentStatus: number,
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (currentStatus === 1) {
    await handleDisableModel(id, queryClient, onSuccess)
  } else {
    await handleEnableModel(id, queryClient, onSuccess)
  }
}

// ============================================================================
// Batch Status Actions
// ============================================================================

/**
 * Batch enable models
 */
export async function handleBatchEnableModels(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }

  try {
    const enablePromises = ids.map((id) => updateModelStatus(id, 1))
    const results = await Promise.all(enablePromises)

    let successCount = 0
    let failedCount = 0

    results.forEach((res) => {
      if (res.success) {
        successCount++
      } else {
        failedCount++
      }
    })

    if (successCount > 0) {
      toast.success(
        i18next.t('Shown {{count}} models in model square', {
          count: successCount,
        })
      )
      if (queryClient) await invalidateVendorData(queryClient)
      onSuccess?.()
    }

    if (failedCount > 0) {
      toast.error(
        i18next.t('Failed to enable {{count}} model(s)', { count: failedCount })
      )
    }
  } catch (error: unknown) {
    handleServerError(error, i18next.t('Batch enable failed'))
  }
}

/**
 * Batch disable models
 */
export async function handleBatchDisableModels(
  ids: number[],
  queryClient?: QueryClient,
  onSuccess?: () => void
): Promise<void> {
  if (ids.length === 0) {
    toast.error(i18next.t('Please select at least one model'))
    return
  }

  try {
    const disablePromises = ids.map((id) => updateModelStatus(id, 0))
    const results = await Promise.all(disablePromises)

    let successCount = 0
    let failedCount = 0

    results.forEach((res) => {
      if (res.success) {
        successCount++
      } else {
        failedCount++
      }
    })

    if (successCount > 0) {
      toast.success(
        i18next.t('Hidden {{count}} models from model square', {
          count: successCount,
        })
      )
      if (queryClient) await invalidateVendorData(queryClient)
      onSuccess?.()
    }

    if (failedCount > 0) {
      toast.error(
        i18next.t('Failed to disable {{count}} model(s)', {
          count: failedCount,
        })
      )
    }
  } catch (error: unknown) {
    handleServerError(error, i18next.t('Batch disable failed'))
  }
}
