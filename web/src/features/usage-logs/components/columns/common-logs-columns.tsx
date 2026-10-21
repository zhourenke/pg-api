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
import type { ColumnDef } from '@tanstack/react-table'
import { GitBranch, Sparkles, KeyRound } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { GroupBadge } from '@/components/group-badge'
import { StatusBadge, type StatusBadgeProps } from '@/components/status-badge'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toIntlLocale } from '@/i18n/languages'
import { getUserAvatarFallback, getUserAvatarStyle } from '@/lib/avatar'
import { formatBillingCurrencyFromUSD } from '@/lib/currency'
import {
  formatLogQuota,
  formatNumber,
  formatTimestampToDate,
} from '@/lib/format'
import { cn } from '@/lib/utils'
import { useSystemConfigStore } from '@/stores/system-config-store'

import { LOG_TYPE_ALL_VALUE } from '../../constants'
import type { UsageLog } from '../../data/schema'
import {
  formatModelName,
  getTieredBillingSummary,
  getLogDurationMs,
  getThroughput,
  hasAnyCacheTokens,
  parseLogOther,
  isViolationFeeLog,
  renderAuditContent,
} from '../../lib/format'
import {
  isDisplayableLogType,
  isTimingLogType,
  getLogTypeConfig,
  isPerCallBilling,
} from '../../lib/utils'
import type { LogOtherData } from '../../types'
import { DetailsDialog } from '../dialogs/details-dialog'
import { LogCostDisplay } from '../log-cost-display'
import { ModelBadge } from '../model-badge'
import { TimingMetricsCell, StreamTpsCell } from '../timing-metrics-cell'
import { useUsageLogsContext } from '../usage-logs-provider'

interface DetailSegment {
  text: string
  muted?: boolean
  danger?: boolean
}

function formatRatioCompact(ratio: number | undefined): string {
  if (ratio == null || !Number.isFinite(ratio)) return '-'
  return ratio % 1 === 0
    ? String(ratio)
    : ratio.toFixed(4).replace(/\.?0+$/, '')
}

function getGroupRatio(other: LogOtherData | null): number | null {
  const userGroupRatio = other?.user_group_ratio
  if (
    userGroupRatio != null &&
    userGroupRatio !== -1 &&
    Number.isFinite(userGroupRatio)
  ) {
    return userGroupRatio
  }

  const groupRatio = other?.group_ratio
  if (groupRatio != null && groupRatio !== 1 && Number.isFinite(groupRatio)) {
    return groupRatio
  }

  return null
}

function buildDetailSegments(
  log: UsageLog,
  other: LogOtherData | null,
  t: (key: string, opts?: Record<string, unknown>) => string,
  isAdmin: boolean
): DetailSegment[] {
  const segments = buildTypeDetailSegments(log, other, t)
  const adminSegments: DetailSegment[] = []
  // Quota saturation is a rare, admin-only anomaly marker; surface it first
  // and in danger styling so it stands out on the related billing log. The
  // backend already strips admin_info for non-admins; gate on isAdmin too as
  // defense in depth so the marker never leaks if that changes.
  if (isAdmin && other?.admin_info?.quota_saturation) {
    adminSegments.push({ text: t('Quota clamped'), danger: true })
  }
  return [...adminSegments, ...segments]
}

function buildTypeDetailSegments(
  log: UsageLog,
  other: LogOtherData | null,
  t: (key: string, opts?: Record<string, unknown>) => string
): DetailSegment[] {
  // Top-up, audit, and login logs can carry a localized operation descriptor.
  if (log.type === 1 || log.type === 3 || log.type === 7) {
    const text = renderAuditContent(other, t)
    return text ? [{ text }] : []
  }

  if (log.type === 6) {
    return [{ text: t('Async task refund') }]
  }

  if (log.type !== 2) return []

  const isViolation = isViolationFeeLog(other)
  if (isViolation) {
    const segments: DetailSegment[] = []
    segments.push({ text: t('Violation Fee'), danger: true })
    if (other?.violation_fee_code) {
      segments.push({
        text: other.violation_fee_code,
        muted: true,
      })
    }
    segments.push({
      text: `${t('Fee')}: ${formatLogQuota(other?.fee_quota ?? log.quota)}`,
      muted: true,
    })
    return segments
  }

  if (!other) return []

  const segments: DetailSegment[] = []

  const priceOpts = { digitsLarge: 4, digitsSmall: 6, abbreviate: false }
  const formatPriceCompact = (price: number) =>
    formatBillingCurrencyFromUSD(price, priceOpts)
  // Every billing mode writes its prices the same way: the numbers in the order
  // the detail dialog breaks them down, separated by " / ", with the unit
  // written once at the end. Labels that name the plan stay out of the preview
  // because the dialog names them.
  const formatPriceList = (prices: string[], unit: string) =>
    `${prices.join(' / ')} /${unit}`
  const isTieredExpr = other.billing_mode === 'tiered_expr'
  const tieredSummary = getTieredBillingSummary(other)
  if (isTieredExpr) {
    if (tieredSummary) {
      // Input, output and cache prices read as one list, which keeps the cache
      // price visible next to the prices it belongs with instead of the cell
      // hiding it behind its "+N" counter.
      const prices = tieredSummary.priceEntries
        .filter((entry) =>
          [
            'inputPrice',
            'outputPrice',
            'cacheReadPrice',
            'cacheCreatePrice',
            'cacheCreate1hPrice',
          ].includes(entry.field)
        )
        .map((entry) => formatPriceCompact(entry.price))
      if (prices.length > 0) {
        segments.push({ text: formatPriceList(prices, '1M') })
      }

      const otherEntries = tieredSummary.priceEntries
        .filter(
          (entry) =>
            ![
              'inputPrice',
              'outputPrice',
              'cacheReadPrice',
              'cacheCreatePrice',
              'cacheCreate1hPrice',
            ].includes(entry.field)
        )
        .map((entry) =>
          entry.unit
            ? formatPriceList([formatPriceCompact(entry.price)], t(entry.unit))
            : `${t(entry.shortLabel)} ${formatPriceList([formatPriceCompact(entry.price)], '1M')}`
        )
      if (otherEntries.length > 0) {
        segments.push({
          text: otherEntries.join(' · '),
          muted: true,
        })
      }
    } else {
      segments.push({
        text: `${t('Dynamic Pricing')} · ${t('No matching results')}`,
        muted: true,
      })
    }
  } else {
    const modelPrice = other.model_price
    const isPerCall = isPerCallBilling(modelPrice)
    if (isPerCall && modelPrice != null) {
      segments.push({
        text: formatPriceList([formatPriceCompact(modelPrice)], t('request')),
      })
    } else if (other.model_ratio != null) {
      const inputPriceUSD = other.model_ratio * 2.0
      const baseEntries = [formatPriceCompact(inputPriceUSD)]
      if (other.completion_ratio != null) {
        baseEntries.push(
          formatPriceCompact(inputPriceUSD * other.completion_ratio)
        )
      }

      const cacheEntries = hasAnyCacheTokens(other)
        ? ([
            other.cache_ratio != null && other.cache_ratio !== 1
              ? formatPriceCompact(inputPriceUSD * other.cache_ratio)
              : null,
            other.cache_creation_ratio != null &&
            other.cache_creation_ratio !== 1
              ? formatPriceCompact(inputPriceUSD * other.cache_creation_ratio)
              : null,
            other.cache_creation_ratio_1h != null &&
            other.cache_creation_ratio_1h !== 0
              ? formatPriceCompact(
                  inputPriceUSD * other.cache_creation_ratio_1h
                )
              : null,
          ].filter(Boolean) as string[])
        : []

      segments.push({
        text: formatPriceList([...baseEntries, ...cacheEntries], '1M'),
      })
    } else {
      const userGroupRatio = other.user_group_ratio
      const groupRatio = other.group_ratio
      const isUserGroup =
        userGroupRatio != null &&
        Number.isFinite(userGroupRatio) &&
        userGroupRatio !== -1
      const effectiveRatio = isUserGroup ? userGroupRatio : groupRatio
      const ratioLabel = isUserGroup
        ? t('User Exclusive Ratio')
        : t('Group Ratio')

      if (effectiveRatio != null && Number.isFinite(effectiveRatio)) {
        segments.push({
          text: `${ratioLabel} ${formatRatioCompact(effectiveRatio)}x`,
        })
      }
    }
  }

  if (other.is_system_prompt_overwritten) {
    segments.push({
      text: t('System Prompt Override'),
      danger: true,
    })
  }

  return segments
}

export function useCommonLogsColumns(
  isAdmin: boolean,
  isRoot: boolean
): ColumnDef<UsageLog>[] {
  const { t, i18n } = useTranslation()
  const locale = toIntlLocale(i18n.resolvedLanguage || i18n.language)
  const currency = useSystemConfigStore((state) => state.config.currency)
  return useMemo(() => {
    const columns: ColumnDef<UsageLog>[] = [
      {
        accessorKey: 'created_at',
        header: t('Time'),
        cell: ({ row }) => {
          const log = row.original
          const timestamp = row.getValue('created_at') as number
          const config = getLogTypeConfig(log.type)

          return (
            <div className='flex max-w-full min-w-0 flex-col gap-0.5'>
              <span className='max-w-full min-w-0 truncate font-mono text-xs tabular-nums'>
                {formatTimestampToDate(timestamp)}
              </span>
              <StatusBadge
                label={t(config.label)}
                variant={config.color as StatusBadgeProps['variant']}
                size='sm'
                copyable={false}
                className='-ml-1.5 max-w-full min-w-0 !text-xs [&_span]:!text-xs'
              />
            </div>
          )
        },
        filterFn: (row, _id, value) => {
          if (!Array.isArray(value) || value.length === 0) return true
          if (value.includes(LOG_TYPE_ALL_VALUE)) return true
          return value.includes(String(row.original.type))
        },
      },
    ]

    if (isAdmin) {
      columns.push(
        {
          id: 'channel',
          header: t('Channel'),
          size: 140,
          accessorFn: (row) => row.channel,
          cell: function ChannelCell({ row }) {
            const {
              sensitiveVisible,
              setAffinityTarget,
              setAffinityDialogOpen,
            } = useUsageLogsContext()
            const log = row.original

            if (!isDisplayableLogType(log.type)) return null

            const other = parseLogOther(log.other)
            const affinity = other?.admin_info?.channel_affinity
            const rawUseChannel = other?.admin_info?.use_channel ?? []
            const useChannel = Array.isArray(rawUseChannel)
              ? rawUseChannel.map(String).filter(Boolean)
              : []
            const hasRetryChain = useChannel.length > 1
            const channelChain = hasRetryChain
              ? useChannel.join(' → ')
              : undefined
            const channelIdDisplay = `#${log.channel}`
            const channelName = sensitiveVisible ? log.channel_name : '••••'
            const multiKeyIndex = other?.admin_info?.multi_key_index
            const showMultiKeyIndex =
              other?.admin_info?.is_multi_key === true &&
              typeof multiKeyIndex === 'number' &&
              Number.isFinite(multiKeyIndex)

            return (
              <div className='flex max-w-full min-w-0 flex-col gap-0.5'>
                <div className='relative inline-flex w-fit max-w-full min-w-0 items-center gap-1'>
                  <StatusBadge
                    label={channelIdDisplay}
                    autoColor={String(log.channel)}
                    copyText={String(log.channel)}
                    size='sm'
                    showDot={false}
                    className='font-mono'
                  />
                  {showMultiKeyIndex && (
                    <StatusBadge
                      label={String(multiKeyIndex)}
                      size='sm'
                      showDot={false}
                      copyable={false}
                      variant='neutral'
                      className='h-5 min-w-5 justify-center rounded-full px-1 font-mono text-xs'
                      aria-label={`${t('Key')} ${multiKeyIndex}`}
                    />
                  )}
                  {hasRetryChain && (
                    <Popover>
                      <PopoverTrigger
                        render={
                          <button
                            type='button'
                            className='text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-5 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:outline-none'
                            aria-label={t('Retry Chain')}
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <GitBranch
                          className='size-3.5 text-amber-500'
                          aria-hidden='true'
                        />
                      </PopoverTrigger>
                      <PopoverContent
                        side='top'
                        align='start'
                        className='w-64 text-xs'
                      >
                        <div className='flex flex-col gap-1'>
                          <p className='font-medium'>{t('Retry Chain')}</p>
                          <p className='text-muted-foreground font-mono break-all'>
                            {channelChain}
                          </p>
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {affinity && (
                    <button
                      type='button'
                      className='absolute -top-1 -right-1 leading-none text-amber-500'
                      title={t('Channel Affinity')}
                      onClick={(e) => {
                        e.stopPropagation()
                        setAffinityTarget({
                          rule_name: affinity.rule_name || '',
                          using_group:
                            affinity.using_group ||
                            affinity.selected_group ||
                            '',
                          key_hint: affinity.key_hint || '',
                          key_fp: affinity.key_fp || '',
                        })
                        setAffinityDialogOpen(true)
                      }}
                    >
                      <Sparkles className='size-3 fill-current' />
                    </button>
                  )}
                </div>
                {log.channel_name && (
                  <span className='text-muted-foreground/70 max-w-full min-w-0 truncate [font-family:var(--font-body)] !text-xs'>
                    {channelName}
                  </span>
                )}
              </div>
            )
          },
        },
        {
          id: 'user',
          header: t('User'),
          size: 120,
          accessorFn: (row) => row.username,
          cell: function UserCell({ row }) {
            const {
              sensitiveVisible,
              setSelectedUserId,
              setUserInfoDialogOpen,
            } = useUsageLogsContext()
            const log = row.original

            if (!log.username) return null

            return (
              <button
                type='button'
                className='flex max-w-full min-w-0 cursor-pointer items-center gap-1.5 text-left'
                title={t('Click to view full details')}
                onClick={(e) => {
                  e.stopPropagation()
                  setSelectedUserId(log.user_id)
                  setUserInfoDialogOpen(true)
                }}
              >
                <Avatar className='ring-border/60 size-6 shrink-0 ring-1 max-sm:hidden'>
                  <AvatarFallback
                    className={cn(
                      'text-[11px] font-semibold',
                      !sensitiveVisible && 'bg-muted text-muted-foreground'
                    )}
                    style={
                      sensitiveVisible
                        ? getUserAvatarStyle(log.username)
                        : undefined
                    }
                  >
                    {sensitiveVisible
                      ? getUserAvatarFallback(log.username)
                      : '•'}
                  </AvatarFallback>
                </Avatar>
                <span className='text-foreground max-w-full min-w-0 truncate text-sm hover:underline'>
                  {sensitiveVisible ? log.username : '••••'}
                </span>
              </button>
            )
          },
        }
      )
    }

    columns.push({
      accessorKey: 'token_name',
      header: t('Token'),
      cell: function TokenNameCell({ row }) {
        const { sensitiveVisible } = useUsageLogsContext()
        const log = row.original
        if (!isDisplayableLogType(log.type)) return null

        const tokenName = log.token_name
        if (!tokenName) return null

        const other = parseLogOther(log.other)
        const displayName = sensitiveVisible ? tokenName : '••••'
        const group = log.group || ''
        const groupRatio = getGroupRatio(other)

        return (
          <div className='flex max-w-full min-w-0 flex-col gap-0.5'>
            <TooltipProvider delay={300}>
              <Tooltip>
                <TooltipTrigger render={<div className='max-w-full min-w-0' />}>
                  <StatusBadge
                    label={displayName}
                    icon={KeyRound}
                    copyText={sensitiveVisible ? tokenName : undefined}
                    size='sm'
                    showDot={false}
                    className='border-border/60 dark:bg-muted/30 text-foreground h-6 max-w-full gap-1.5 overflow-hidden rounded-md border bg-white px-2 py-0.5 [font-family:var(--font-body)]'
                  />
                </TooltipTrigger>
                {sensitiveVisible && tokenName.length > 16 && (
                  <TooltipContent side='top' className='max-w-xs break-all'>
                    {tokenName}
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
            {(group || groupRatio != null) && (
              <span className='flex max-w-full min-w-0 items-baseline gap-1 text-xs leading-normal'>
                {group ? (
                  <GroupBadge
                    group={group}
                    label={sensitiveVisible ? undefined : '••••'}
                    type='text'
                    size='sm'
                    className='min-w-0 shrink truncate align-baseline text-xs leading-normal [&>span]:min-w-0 [&>span]:truncate [&>span]:leading-normal'
                  />
                ) : null}
                {groupRatio != null ? (
                  <span className='text-muted-foreground/60 shrink-0 tabular-nums'>
                    {formatRatioCompact(groupRatio)}x
                  </span>
                ) : null}
              </span>
            )}
          </div>
        )
      },
    })
    columns.push(
      {
        accessorKey: 'model_name',
        header: t('Model'),
        cell: function ModelCell({ row }) {
          const log = row.original
          if (!isDisplayableLogType(log.type)) return null

          const modelInfo = formatModelName(log)

          return (
            <div className='flex max-w-full min-w-0 flex-col items-start gap-0.5'>
              <ModelBadge
                modelName={modelInfo.name}
                actualModel={modelInfo.actualModel}
                responseModel={modelInfo.responseModel}
              />
            </div>
          )
        },
        meta: { mobileTitle: true },
      },
      {
        accessorKey: 'is_stream',
        header: t('Stream'),
        cell: ({ row }) => {
          const log = row.original
          if (!isTimingLogType(log.type)) return null

          const other = parseLogOther(log.other)
          const throughput = getThroughput(log, other)

          return (
            <StreamTpsCell
              isStream={log.is_stream}
              throughput={throughput}
              streamStatus={other?.stream_status}
            />
          )
        },
        meta: { label: t('Stream') },
      },
      {
        accessorKey: 'prompt_tokens',
        header: 'Tokens',
        cell: ({ row }) => {
          const log = row.original
          if (!isDisplayableLogType(log.type)) return null

          const other = parseLogOther(log.other)

          const promptTokens = log.prompt_tokens || 0
          const completionTokens = log.completion_tokens || 0
          if (promptTokens === 0 && completionTokens === 0) {
            return <span className='text-muted-foreground text-xs'>-</span>
          }

          const cacheReadTokens = other?.cache_tokens || 0
          const cacheWrite5m = other?.cache_creation_tokens_5m || 0
          const cacheWrite1h = other?.cache_creation_tokens_1h || 0
          const hasSplitCache = cacheWrite5m > 0 || cacheWrite1h > 0
          const cacheWriteTokens = hasSplitCache
            ? cacheWrite5m + cacheWrite1h
            : other?.cache_creation_tokens || 0

          const hasCache = cacheReadTokens > 0 || cacheWriteTokens > 0
          const formattedPrompt = formatNumber(promptTokens, locale)
          const formattedCompletion = formatNumber(completionTokens, locale)
          const formattedCacheRead = formatNumber(cacheReadTokens, locale)
          const formattedCacheWrite = formatNumber(cacheWriteTokens, locale)

          const tooltipLines = [
            `${t('Input Tokens')}: ${formattedPrompt}`,
            `${t('Output Tokens')}: ${formattedCompletion}`,
          ]
          if (cacheReadTokens > 0) {
            tooltipLines.push(`${t('Cache Read')}: ${formattedCacheRead}`)
          }
          if (cacheWriteTokens > 0) {
            if (hasSplitCache) {
              if (cacheWrite5m > 0) {
                tooltipLines.push(
                  `${t('Cache Write (5m)')}: ${formatNumber(cacheWrite5m, locale)}`
                )
              }
              if (cacheWrite1h > 0) {
                tooltipLines.push(
                  `${t('Cache Write (1h)')}: ${formatNumber(cacheWrite1h, locale)}`
                )
              }
            } else {
              tooltipLines.push(`${t('Cache Write')}: ${formattedCacheWrite}`)
            }
          }

          return (
            <div
              className='flex w-max max-w-full min-w-0 flex-col gap-0.5'
              title={tooltipLines.join('\n')}
            >
              <span className='max-w-full min-w-0 truncate font-mono text-xs font-medium tabular-nums'>
                {formattedPrompt} / {formattedCompletion}
              </span>
              {hasCache && (
                <div className='flex w-max max-w-full items-center gap-1 text-[11px] leading-tight'>
                  {cacheReadTokens > 0 && (
                    <span className='text-muted-foreground/60 min-w-0 truncate tabular-nums'>
                      {t('Cache')}↓ {formattedCacheRead}
                    </span>
                  )}
                  {cacheWriteTokens > 0 && (
                    <span className='text-muted-foreground/60 min-w-0 truncate tabular-nums'>
                      {cacheReadTokens > 0 ? '↑' : `${t('Cache')}↑`}{' '}
                      {formattedCacheWrite}
                    </span>
                  )}
                </div>
              )}
            </div>
          )
        },
      },
      {
        accessorKey: 'quota',
        header: t('Cost'),
        cell: ({ row }) => {
          const log = row.original
          if (!isDisplayableLogType(log.type)) return null

          const quota = row.getValue('quota') as number
          const other = parseLogOther(log.other)
          return <LogCostDisplay quota={quota} other={other} />
        },
      },

      {
        accessorKey: 'use_time',
        header: t('Timing'),
        cell: ({ row }) => {
          const log = row.original
          if (!isTimingLogType(log.type)) return null

          const other = parseLogOther(log.other)

          return (
            <TimingMetricsCell
              durationMs={getLogDurationMs(log, other)}
              completionTokens={log.completion_tokens}
              frtMs={log.frt != null && log.frt > 0 ? log.frt : other?.frt}
              isStream={log.is_stream}
            />
          )
        },
      },

      {
        accessorKey: 'content',
        header: t('Log Details'),
        cell: function DetailsCell({ row }) {
          const { t } = useTranslation()
          const [dialogOpen, setDialogOpen] = useState(false)
          const log = row.original
          const other = parseLogOther(log.other)

          const segments = buildDetailSegments(log, other, t, isAdmin)
          const primary = segments[0]
          const hasMore = segments.length > 1
          let primaryTextClass = 'text-foreground'
          if (primary?.muted) {
            primaryTextClass = 'text-muted-foreground/60'
          } else if (primary?.danger) {
            primaryTextClass = 'text-red-600 dark:text-red-400'
          }
          let detailPreview = (
            <span className='text-muted-foreground/40'>—</span>
          )
          if (primary) {
            detailPreview = (
              <span
                className={cn(
                  'flex max-w-full min-w-0 items-center leading-snug no-underline hover:underline',
                  primaryTextClass
                )}
              >
                <span className='min-w-0 truncate'>{primary.text}</span>
                {hasMore && (
                  <span className='text-muted-foreground/40 ml-0.5 shrink-0'>
                    +{segments.length - 1}
                  </span>
                )}
              </span>
            )
          } else if (log.content) {
            detailPreview = (
              <span className='text-muted-foreground block max-w-full min-w-0 truncate no-underline hover:underline'>
                {log.content}
              </span>
            )
          }

          return (
            <>
              <button
                type='button'
                className='flex max-w-full min-w-0 cursor-pointer items-center gap-1 text-left text-xs'
                onClick={() => setDialogOpen(true)}
                title={t('Click to view full details')}
              >
                {detailPreview}
              </button>
              <DetailsDialog
                log={log}
                isAdmin={isAdmin}
                isRoot={isRoot}
                open={dialogOpen}
                onOpenChange={setDialogOpen}
              />
            </>
          )
        },
      }
    )

    return columns
    // Log formatters read currency settings from the store.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, isAdmin, isRoot, currency, locale])
}
