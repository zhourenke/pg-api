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
import { normalizeTierLabel, type ParsedTier } from './billing-expr'

function tierMatchesNormalizedLabel(
  tier: ParsedTier,
  normalizedMatchedTierLabel: string
): boolean {
  return (
    normalizedMatchedTierLabel !== '' &&
    normalizeTierLabel(tier.label) === normalizedMatchedTierLabel
  )
}

/**
 * Decide whether a price-table row is the settlement hit.
 *
 * A shared engine label can cover both a token branch and a per-request
 * branch, so the recorded billing unit and fixed price decide between them
 * before label equality is considered.
 */
export function isBreakdownTierMatched(
  tier: ParsedTier,
  matchedTierLabel?: string | null,
  billingUnit?: 'token' | 'request',
  fixedPrice?: number
): boolean {
  if (billingUnit) {
    if ((tier.billingUnit ?? 'token') !== billingUnit) return false
    if (
      billingUnit === 'request' &&
      fixedPrice !== undefined &&
      tier.fixedPrice !== fixedPrice
    ) {
      return false
    }
  }
  return tierMatchesNormalizedLabel(
    tier,
    normalizeTierLabel(matchedTierLabel ?? undefined)
  )
}
