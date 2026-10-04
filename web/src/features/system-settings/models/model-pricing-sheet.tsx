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
import { zodResolver } from '@hookform/resolvers/zod'
import { Save } from 'lucide-react'
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { sideDrawerContentClassName } from '@/components/drawer-layout'
import { Button } from '@/components/ui/button'
import { FieldGroup } from '@/components/ui/field'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  getSitePricingCurrency,
  isValidPricingCurrency,
  USD_PRICING_CURRENCY,
} from '@/features/model-pricing/currency'
import { PricingCurrencySelector } from '@/features/model-pricing/pricing-currency-selector'
import { combineBillingExpr } from '@/features/pricing/lib/billing-expr'
import { cn } from '@/lib/utils'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import {
  createModelPricingSchema,
  type ModelPricingFormValues,
  type ModelRatioData,
} from './model-pricing-core'
import { TieredPricingEditor } from './tiered-pricing-editor'

export type { ModelRatioData } from './model-pricing-core'

type ModelPricingSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  editData?: ModelRatioData | null
  onSave?: () => void | Promise<void>
  isSaving?: boolean
  onDirtyChange?: (dirty: boolean) => void
}

type ModelPricingEditorPanelProps = Omit<
  ModelPricingSheetProps,
  'open' | 'onOpenChange'
> & {
  className?: string
  embedded?: boolean
  scrollHeader?: ReactNode
}

export type ModelPricingEditorPanelHandle = {
  commitDraft: () => Promise<ModelRatioData | null>
}

const DEFAULT_TOKEN_BILLING_EXPR = 'tier("base", p * 0 + c * 0)'

export const ModelPricingSheet = forwardRef<
  ModelPricingEditorPanelHandle,
  ModelPricingSheetProps
>(function ModelPricingSheet(
  { open, onOpenChange, editData, onSave, isSaving, onDirtyChange },
  ref
) {
  const { t } = useTranslation()
  const title = editData ? t('Edit model pricing') : t('Add model pricing')
  const description = editData?.name || t('New model')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side='right'
        className={sideDrawerContentClassName('sm:max-w-2xl')}
      >
        <SheetHeader className='sr-only'>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <ModelPricingEditorPanel
          ref={ref}
          editData={editData}
          onDirtyChange={onDirtyChange}
          onSave={onSave}
          isSaving={isSaving}
          className='h-full rounded-none border-0'
        />
      </SheetContent>
    </Sheet>
  )
})

export const ModelPricingEditorPanel = forwardRef<
  ModelPricingEditorPanelHandle,
  ModelPricingEditorPanelProps
>(function ModelPricingEditorPanel(
  {
    editData,
    className,
    onSave,
    isSaving,
    onDirtyChange,
    embedded = false,
    scrollHeader,
  },
  ref
) {
  const { t } = useTranslation()
  const formElementRef = useRef<HTMLFormElement>(null)
  const currencyConfig = useSystemConfigStore((state) => state.config.currency)
  const preference = usePricingPreferencesStore((state) => state.currency)
  const siteCurrency = useMemo(
    () => getSitePricingCurrency(currencyConfig),
    [currencyConfig]
  )
  const currency =
    preference === 'site' && isValidPricingCurrency(siteCurrency)
      ? siteCurrency
      : USD_PRICING_CURRENCY
  const [billingExpr, setBillingExpr] = useState(DEFAULT_TOKEN_BILLING_EXPR)
  const [requestRuleExpr, setRequestRuleExpr] = useState('')
  const [editorReloadToken, setEditorReloadToken] = useState(0)
  const isEditMode = !!editData
  const initialBillingExpr = editData?.billingExpr || DEFAULT_TOKEN_BILLING_EXPR

  const form = useForm<ModelPricingFormValues>({
    resolver: zodResolver(createModelPricingSchema(t)),
    defaultValues: { name: '' },
  })
  const watchedValues = form.watch()

  useEffect(() => {
    setEditorReloadToken((token) => token + 1)

    if (editData) {
      form.reset({ name: editData.name })
      setBillingExpr(initialBillingExpr)
      setRequestRuleExpr(editData.requestRuleExpr || '')
    } else {
      form.reset({ name: '' })
      setBillingExpr(DEFAULT_TOKEN_BILLING_EXPR)
      setRequestRuleExpr('')
    }
  }, [editData, form, initialBillingExpr])

  useEffect(() => {
    onDirtyChange?.(
      form.formState.isDirty ||
        billingExpr !== initialBillingExpr ||
        requestRuleExpr !== (editData?.requestRuleExpr ?? '')
    )
  }, [
    onDirtyChange,
    form.formState.isDirty,
    billingExpr,
    requestRuleExpr,
    editData,
    initialBillingExpr,
  ])

  const expressionPreview = useMemo(
    () => combineBillingExpr(billingExpr, requestRuleExpr),
    [billingExpr, requestRuleExpr]
  )

  const buildSubmitData = useCallback(
    (values: ModelPricingFormValues): ModelRatioData => ({
      name: values.name.trim(),
      billingMode: 'tiered_expr',
      billingExpr,
      requestRuleExpr,
    }),
    [billingExpr, requestRuleExpr]
  )

  useImperativeHandle(
    ref,
    () => ({
      commitDraft: async () => {
        if (
          formElementRef.current?.querySelector('[data-billing-invalid="true"]')
        ) {
          return null
        }
        const isValid = await form.trigger()
        if (!isValid) return null
        return buildSubmitData(form.getValues())
      },
    }),
    [form, buildSubmitData]
  )

  const expressionEditor = (
    <TieredPricingEditor
      currency={currency}
      key={editorReloadToken}
      modelName={watchedValues.name}
      billingExpr={billingExpr}
      requestRuleExpr={requestRuleExpr}
      onBillingExprChange={setBillingExpr}
      onRequestRuleExprChange={setRequestRuleExpr}
    />
  )

  const showActions = Boolean(onSave)

  return (
    <div
      className={cn(
        'bg-background flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border',
        className
      )}
    >
      {!embedded && (
        <div className='border-b p-4'>
          <div className='flex flex-wrap items-start justify-between gap-3'>
            <div className='min-w-0'>
              <h3 className='truncate text-base font-medium'>
                {isEditMode ? t('Edit model pricing') : t('Add model pricing')}
              </h3>
            </div>
          </div>
        </div>
      )}

      <Form {...form}>
        <form
          ref={formElementRef}
          onSubmit={(event) => event.preventDefault()}
          className='flex min-h-0 flex-1 flex-col'
          autoComplete='off'
        >
          <div
            role='region'
            aria-label={
              isEditMode ? t('Edit model pricing') : t('Add model pricing')
            }
            className='@container/pricing-editor min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 pb-6'
          >
            {scrollHeader && (
              <div className='mb-4 space-y-3'>{scrollHeader}</div>
            )}
            <div className='grid min-w-0 items-start gap-4 @min-[960px]/pricing-editor:grid-cols-[minmax(0,1fr)_260px]'>
              <FieldGroup className='min-w-0'>
                {!embedded && (
                  <FormField
                    control={form.control}
                    name='name'
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('Model name')}</FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('gpt-4')}
                            {...field}
                            disabled={isEditMode}
                          />
                        </FormControl>
                        <FormDescription>
                          {t(
                            'The exact model identifier as used in API requests.'
                          )}
                        </FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <PricingCurrencySelector siteCurrency={siteCurrency} />

                {expressionEditor}
              </FieldGroup>

              <aside
                aria-label={t('Billing expression (USD)')}
                className='bg-muted/20 min-w-0 rounded-lg border @min-[960px]/pricing-editor:sticky @min-[960px]/pricing-editor:top-0'
              >
                <div className='border-b px-3 py-2'>
                  <div className='text-sm font-medium'>
                    {t('Billing expression (USD)')}
                  </div>
                </div>
                <div className='px-3 py-2.5'>
                  <span className='font-mono text-xs leading-5 break-words whitespace-pre-wrap'>
                    {expressionPreview}
                  </span>
                </div>
              </aside>
            </div>
          </div>
          {showActions && (
            <div className='bg-background/95 supports-[backdrop-filter]:bg-background/80 shrink-0 border-t p-3 backdrop-blur'>
              <div className='flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'>
                {onSave && (
                  <Button
                    type='button'
                    onClick={onSave}
                    disabled={isSaving}
                    className='w-full sm:w-auto'
                  >
                    <Save data-icon='inline-start' />
                    {isSaving ? t('Saving...') : t('Save model prices')}
                  </Button>
                )}
              </div>
            </div>
          )}
        </form>
      </Form>
    </div>
  )
})
