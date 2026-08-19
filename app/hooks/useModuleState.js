'use client'

// app/hooks/useModuleState.js
// Shared module-selection state for the paginated dashboards. Both the admin
// dashboard switcher (/admin) and the member "My Coop" module picker
// (/my-coop) read and write the SAME ?module= URL param, so whichever surface
// the user is on, the selection stays in sync and stays shareable.
//
// Rules (identical to the behaviour the admin dashboard had inline):
//   - the FIRST module in `modules` is the default and renders with NO param
//   - every other module renders as ?module=<key>
//   - unknown or missing keys fall back to the default
//
// Usage:
//   const [module, setModule] = useModuleState(MODULES) // [{ key: 'food' }, { key: 'ram' }]

import { useCallback } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export default function useModuleState(modules) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const defaultKey = modules[0]?.key || 'food'
  const requested = searchParams?.get('module') || defaultKey
  const selected = modules.some((m) => m.key === requested) ? requested : defaultKey

  const setModule = useCallback(
    (key) => {
      const next = modules.some((m) => m.key === key) ? key : defaultKey
      const query = next === defaultKey ? '' : `?module=${encodeURIComponent(next)}`
      router.replace(`${pathname}${query}`, { scroll: false })
    },
    [router, pathname, modules, defaultKey]
  )

  return [selected, setModule]
}
