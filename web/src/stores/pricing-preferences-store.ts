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
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type PricingCurrencyPreference = 'USD' | 'site'

type PricingPreferences = {
  currency: PricingCurrencyPreference
  setCurrency: (currency: PricingCurrencyPreference) => void
}

/**
 * Shared by every pricing surface (the model pricing editor and the tool price
 * table). The default follows the site currency, because a site that configured
 * CNY or a custom currency did so to think in it; a site without one resolves
 * to USD through `resolvePricingCurrency`. An operator who explicitly picked a
 * currency keeps it — the persisted value wins over this default.
 */
export const usePricingPreferencesStore = create<PricingPreferences>()(
  persist(
    (set) => ({
      currency: 'site',
      setCurrency: (currency) => set({ currency }),
    }),
    {
      name: 'model-pricing-preferences',
      partialize: (state) => ({ currency: state.currency }),
    }
  )
)
