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
import { Code2, Copy, Eye, Plus, Trash2 } from 'lucide-react'
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { StaticDataTable } from '@/components/data-table'
import { JsonCodeEditor } from '@/components/json-code-editor'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field, FieldError } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  getSitePricingCurrency,
  resolvePricingCurrency,
  USD_PRICING_CURRENCY,
} from '@/features/model-pricing/currency'
import { PricingAmountInput } from '@/features/model-pricing/pricing-amount-input'
import { PricingCurrencySelector } from '@/features/model-pricing/pricing-currency-selector'
import { usePricingPreferencesStore } from '@/stores/pricing-preferences-store'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { useUpdateOption } from '../hooks/use-update-option'

const OPTION_KEY = 'tool_price_setting.prices'

// The billable built-in tool identities the request-time gate and settlement
// look prices up under, in the order of `ReservedBillableToolNames` in
// relay/common/tool_usage.go. That set, not this list, is the source of truth:
// adding an identity there must add it here too, or the operator cannot see
// which names are demanded.
const BILLABLE_TOOL_IDENTIFIERS = [
  'web_search_preview',
  'web_search',
  'file_search',
  'google_search',
  'image_generation',
]

function ToolIdentifier(props: { children: ReactNode }) {
  return (
    <code className='bg-muted rounded px-1 py-0.5 text-xs'>
      {props.children}
    </code>
  )
}

type ToolPriceRow = {
  id: number
  key: string
  price: string
}

function parseToolPrice(value: string): number | null {
  if (value.trim() === '') return null
  const price = Number(value)
  if (!Number.isFinite(price) || price < 0) return null
  return price
}

function rowsToObject(rows: ToolPriceRow[]): Record<string, number> {
  const prices: Record<string, number> = {}
  for (const row of rows) {
    const k = row.key.trim()
    if (!k) continue
    const price = parseToolPrice(row.price)
    if (price === null) continue
    prices[k] = price
  }
  return prices
}

function objectToRows(prices: Record<string, number>): ToolPriceRow[] {
  return Object.entries(prices).map(([key, price], index) => ({
    id: index + 1,
    key,
    price: String(price),
  }))
}

function parseInitialPrices(
  rawValue: string | undefined
): Record<string, number> {
  if (!rawValue) return {}
  try {
    const parsed = JSON.parse(rawValue) as unknown
    if (
      parsed &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed) &&
      Object.keys(parsed as object).length > 0
    ) {
      const validPrices: Record<string, number> = {}
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
          validPrices[key] = value
        }
      }
      return validPrices
    }
  } catch {
    // fall through to an empty configuration
  }
  return {}
}

type ToolPriceSettingsProps = {
  defaultValue: string
}

export const ToolPriceSettings = memo(function ToolPriceSettings({
  defaultValue,
}: ToolPriceSettingsProps) {
  const { t } = useTranslation()
  const updateOption = useUpdateOption()
  const currencyConfig = useSystemConfigStore((state) => state.config.currency)
  const preference = usePricingPreferencesStore((state) => state.currency)
  const siteCurrency = useMemo(
    () => getSitePricingCurrency(currencyConfig),
    [currencyConfig]
  )
  const currency = resolvePricingCurrency(siteCurrency, preference)
  const priceColumnLabel = t('Price ({{currency}}/1K calls)', {
    currency: currency.symbol,
  })
  const [editMode, setEditMode] = useState<'visual' | 'json'>('visual')
  const [rows, setRows] = useState<ToolPriceRow[]>([])
  const [jsonText, setJsonText] = useState('')
  const [jsonError, setJsonError] = useState('')
  const [nextRowId, setNextRowId] = useState(1)

  useEffect(() => {
    const prices = parseInitialPrices(defaultValue)
    const initialRows = objectToRows(prices)
    setRows(initialRows)
    setJsonText(JSON.stringify(prices, null, 2))
    setJsonError('')
    setNextRowId(initialRows.length + 1)
  }, [defaultValue])

  const currentPrices = useMemo(() => rowsToObject(rows), [rows])
  const invalidRowIds = useMemo(
    () =>
      new Set(
        rows
          .filter((row) => parseToolPrice(row.price) === null)
          .map((row) => row.id)
      ),
    [rows]
  )

  const syncFromRows = useCallback((nextRows: ToolPriceRow[]) => {
    setRows(nextRows)
    setJsonText(JSON.stringify(rowsToObject(nextRows), null, 2))
    setJsonError('')
  }, [])

  const handleJsonChange = useCallback(
    (text: string) => {
      setJsonText(text)
      try {
        const parsed = JSON.parse(text) as unknown
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          setJsonError(t('JSON must be an object'))
          return
        }
        const prices: Record<string, number> = {}
        for (const [key, value] of Object.entries(parsed)) {
          if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0
          ) {
            setJsonError(t('Please enter a valid number'))
            return
          }
          prices[key] = value
        }
        const nextRows = objectToRows(prices)
        setRows(nextRows)
        setNextRowId(nextRows.length + 1)
        setJsonError('')
      } catch (error) {
        setJsonError(error instanceof Error ? error.message : t('Invalid JSON'))
      }
    },
    [t]
  )

  const updateRow = useCallback(
    (id: number, field: 'key' | 'price', value: string) => {
      syncFromRows(
        rows.map((r) => (r.id === id ? { ...r, [field]: value } : r))
      )
    },
    [rows, syncFromRows]
  )

  const addRow = useCallback(() => {
    const newRow: ToolPriceRow = { id: nextRowId, key: '', price: '0' }
    setNextRowId((prev) => prev + 1)
    syncFromRows([...rows, newRow])
  }, [nextRowId, rows, syncFromRows])

  const removeRow = useCallback(
    (id: number) => {
      syncFromRows(rows.filter((r) => r.id !== id))
    },
    [rows, syncFromRows]
  )

  const handleCopyJson = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(jsonText)
      toast.success(t('Copied to clipboard'))
    } catch {
      toast.error(t('Failed to copy'))
    }
  }, [jsonText, t])

  const handleSave = useCallback(async () => {
    if (invalidRowIds.size > 0) {
      toast.error(t('Please enter a valid number'))
      return
    }
    if (editMode === 'json' && jsonError) {
      toast.error(t('Please fix JSON errors before saving'))
      return
    }
    await updateOption.mutateAsync({
      key: OPTION_KEY,
      value: JSON.stringify(currentPrices),
    })
  }, [currentPrices, editMode, invalidRowIds.size, jsonError, t, updateOption])

  const toggleEditMode = useCallback(() => {
    setEditMode((prev) => (prev === 'visual' ? 'json' : 'visual'))
  }, [])

  return (
    <div className='space-y-4'>
      <PricingCurrencySelector siteCurrency={siteCurrency} />

      <Alert>
        <AlertDescription className='space-y-1 text-sm'>
          <div>
            {t(
              'Configure per-tool unit prices ({{currency}}/1K calls). Per-request models do not incur additional tool fees.',
              { currency: currency.symbol }
            )}
          </div>
          {currency !== USD_PRICING_CURRENCY ? (
            <div>
              {t(
                'Prices are saved and billed in USD. The site currency only converts the inputs and the previews; the JSON view shows USD.'
              )}
            </div>
          ) : null}
          <div>
            <span className='font-medium'>{t('Format')}:</span>{' '}
            <ToolIdentifier>web_search_preview</ToolIdentifier>{' '}
            {t('is the default price; ')}
            <ToolIdentifier>web_search_preview:gpt-4o*</ToolIdentifier>{' '}
            {t('overrides for matching model prefix.')}
          </div>
          <div>
            {t(
              'The request gate checks exactly these built-in tool identifiers:'
            )}{' '}
            <ul className='inline-flex flex-wrap items-center gap-1 align-middle'>
              {BILLABLE_TOOL_IDENTIFIERS.map((identifier) => (
                <li key={identifier}>
                  <ToolIdentifier>{identifier}</ToolIdentifier>
                </li>
              ))}
            </ul>{' '}
            {t(
              'Any other identifier prices a custom function call, which is charged only when the upstream reports it and is never gated.'
            )}
          </div>
          <div>
            {t(
              'A versioned spelling such as web_search_20250305 resolves to one of these names before the price lookup, so pricing the versioned spelling has no effect.'
            )}
          </div>
          <div>
            {t(
              'A built-in tool with no price is refused with HTTP 503 instead of running for free; enter 0 to keep a tool free.'
            )}
          </div>
          <div>
            {t(
              'Chat Completions requests carrying web_search_options count as one web_search_preview call each, so they need that price too.'
            )}
          </div>
        </AlertDescription>
      </Alert>

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-2'>
          {editMode === 'visual' ? (
            <Button variant='outline' size='sm' onClick={addRow}>
              <Plus className='mr-2 h-4 w-4' />
              {t('Add')}
            </Button>
          ) : (
            <Button variant='ghost' size='sm' onClick={handleCopyJson}>
              <Copy className='mr-2 h-4 w-4' />
              {t('Copy')}
            </Button>
          )}
        </div>
        <Button variant='outline' size='sm' onClick={toggleEditMode}>
          {editMode === 'visual' ? (
            <>
              <Code2 className='mr-2 h-4 w-4' />
              {t('Switch to JSON')}
            </>
          ) : (
            <>
              <Eye className='mr-2 h-4 w-4' />
              {t('Switch to Visual')}
            </>
          )}
        </Button>
      </div>

      {editMode === 'visual' ? (
        <StaticDataTable
          data={rows}
          getRowKey={(row) => row.id}
          emptyClassName='text-muted-foreground py-8'
          emptyContent={t('No tools configured')}
          columns={[
            {
              id: 'tool',
              header: t('Tool identifier'),
              cell: (row) => (
                <Input
                  value={row.key}
                  aria-label={t('Tool identifier')}
                  onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                />
              ),
            },
            {
              id: 'price',
              header: priceColumnLabel,
              className: 'w-[200px]',
              cell: (row) => {
                const isInvalid = invalidRowIds.has(row.id)
                return (
                  <Field data-invalid={isInvalid}>
                    <PricingAmountInput
                      currency={currency}
                      value={row.price}
                      aria-invalid={isInvalid || undefined}
                      aria-label={`${priceColumnLabel}: ${row.key || t('Tool identifier')}`}
                      onChange={(usd) => updateRow(row.id, 'price', usd)}
                    />
                    {isInvalid ? (
                      <FieldError>
                        {t('Please enter a valid number')}
                      </FieldError>
                    ) : null}
                  </Field>
                )
              },
            },
            {
              id: 'actions',
              header: t('Actions'),
              className: 'text-right',
              cellClassName: 'text-right',
              cell: (row) => (
                <Button
                  variant='ghost'
                  size='icon'
                  onClick={() => removeRow(row.id)}
                  aria-label={t('Delete')}
                >
                  <Trash2 className='text-destructive h-4 w-4' />
                </Button>
              ),
            },
          ]}
        />
      ) : (
        <div className='space-y-2'>
          <JsonCodeEditor
            value={jsonText}
            onChange={handleJsonChange}
            heightClassName='h-72 min-h-72 max-h-72'
            aria-invalid={Boolean(jsonError)}
          />
          {jsonError && <p className='text-destructive text-sm'>{jsonError}</p>}
        </div>
      )}

      <div className='flex justify-end'>
        <Button
          onClick={handleSave}
          disabled={
            updateOption.isPending ||
            invalidRowIds.size > 0 ||
            (editMode === 'json' && !!jsonError)
          }
        >
          {t('Save tool prices')}
        </Button>
      </div>
    </div>
  )
})
