// app/exhibition/page.jsx
// Member-facing Coop Exhibition shop. Browse the branch's exhibition by
// category and vendor hub (auto-rotating hub slideshow), search, and add
// products to the exhibition cart. The shopping surface itself (search,
// filters, product grid, sticky cart bar) lives in ExhibitionCatalog so the
// full catalog page and vendor hub share the exact same buying logic.
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, MapPin, Store } from 'lucide-react'
import ProtectedRoute from '../components/ProtectedRoute'
import ExhibitionCycleHint from '../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../components/ContinueShoppingBanner'
import ExhibitionHubs from '../components/ExhibitionHubs'
import ExhibitionCatalog from '../components/ExhibitionCatalog'
import useExhibitionCatalog from '../hooks/useExhibitionCatalog'
import ModuleClosedPanel from '../components/ModuleClosedPanel'
import { useAuth } from '../contexts/AuthContext'

const STORAGE_KEY = 'exhibitionDeliveryBranch'

function ExhibitionShopContent() {
  const router = useRouter()
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // Delivery location selection — persisted in localStorage so the cart page
  // and re-visits stay in sync.
  const [selectedBranch, setSelectedBranch] = useState(() => {
    try { return localStorage.getItem(`${STORAGE_KEY}_${memberId}`) || '' } catch { return '' }
  })
  const { catalog, error, loading } = useExhibitionCatalog(selectedBranch)

  // Available delivery locations from the catalog response.
  const availableBranches = useMemo(() => catalog?.availableBranches || [], [catalog])

  // Auto-select when only one branch is available.
  useEffect(() => {
    if (availableBranches.length === 1 && !selectedBranch) {
      setSelectedBranch(availableBranches[0].code)
    }
  }, [availableBranches, selectedBranch])

  const handleBranchChange = (code) => {
    setSelectedBranch(code)
    try { localStorage.setItem(`${STORAGE_KEY}_${memberId}`, code) } catch {}
    // Also persist for the cart page.
    try { localStorage.setItem(`exhibitionDeliveryBranch_${memberId}`, code) } catch {}
  }

  const products = useMemo(() => catalog?.products || [], [catalog])
  const vendors = useMemo(() => catalog?.vendors || [], [catalog])

  // Vendors that actually have products, plus per-stand product counts — the
  // hub slideshow's feed.
  const vendorsWithProducts = useMemo(() => {
    const ids = new Set(products.map((p) => p.vendor_id))
    return vendors.filter((v) => ids.has(v.id))
  }, [vendors, products])
  const vendorCounts = useMemo(() => {
    const map = {}
    for (const p of products) map[p.vendor_id] = (map[p.vendor_id] || 0) + 1
    return map
  }, [products])

  // ── Delivery location gate ──────────────────────────────────────
  // When multiple exhibitions are open and none is selected yet, show only
  // the location picker.  Nothing else loads until the member picks one.
  const needBranchPicker = !loading && catalog?.open && availableBranches.length > 1 && !selectedBranch

  // ── Closed state (only when the API explicitly says the market is closed) ──
  if (!loading && catalog && !catalog.open) {
    return (
      <ProtectedRoute allowedRoles={['member']}>
        <div className="min-h-screen bg-canvas">
          <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
            <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
            <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
          </div>
          <ModuleClosedPanel
            module="exhibition"
            variant="inline"
            hint={
              catalog?.cycle?.starts_at || catalog?.cycle?.ends_at ? (
                <ExhibitionCycleHint cycle={catalog.cycle} />
              ) : undefined
            }
            onViewOrders={() => router.push('/orders')}
            onBack={() => router.push('/my-coop')}
          />
        </div>
      </ProtectedRoute>
    )
  }

  // ── Main shop view ─────────────────────────────────────────────
  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
          {/* Continue-shopping banner — surfaces food/ram carts here; the
              exhibition cart is already covered by the sticky cart bar. */}
          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Hero */}
          <div className="mb-fluid-lg flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-accent-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-accent">
                <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                Coop Exhibition
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {catalog?.cycle?.name ? catalog.cycle.name : 'The Exhibition Shop'}
              </h1>
              <p className="mt-1 max-w-xl text-sm text-muted">
                {catalog?.branch
                  ? `Seasonal market at ${catalog.branch}. Browse vendor stands, shop quality goods, pick up in person.`
                  : 'Browse vendor stands and shop quality goods.'}
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-start gap-2 sm:items-end">
              {/* Delivery location dropdown — always shown so members can switch */}
              {availableBranches.length > 0 && (
                <div className="flex items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={2} />
                  <select
                    value={selectedBranch}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    className="rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-medium text-fg focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
                  >
                    {availableBranches.map((b) => (
                      <option key={b.code} value={b.code}>{b.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <span className="hidden items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-chips font-medium text-muted sm:inline-flex">
                <span className="h-1.5 w-1.5 rounded-full bg-success-fg" />
                {catalog?.open ? 'Market open' : 'Market closed'}
              </span>
            </div>
          </div>

          {/* ── Branch picker gate: nothing else loads until they pick ── */}
          {needBranchPicker ? (
            <div className="mx-auto max-w-lg">
              <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-subtle text-accent">
                    <MapPin className="h-5 w-5" strokeWidth={2} />
                  </span>
                  <div>
                    <h2 className="text-base font-semibold text-fg">Select your delivery location</h2>
                    <p className="mt-0.5 text-xs text-muted">Choose where you will pick up your order to see available products.</p>
                  </div>
                </div>

                <div className="mt-5 space-y-2">
                  {availableBranches.map((b) => (
                    <button
                      key={b.code}
                      type="button"
                      onClick={() => handleBranchChange(b.code)}
                      className="flex w-full items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                    >
                      <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
                        <MapPin className="h-5 w-5" strokeWidth={2} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-fg">{b.name}</div>
                        {b.cycleName && <div className="mt-0.5 text-xs text-muted">{b.cycleName}</div>}
                      </div>
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => router.push('/my-coop')}
                  className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-fg"
                >
                  <ArrowLeft className="h-3.5 w-3.5" />
                  Back to My Coop
                </button>
              </div>
            </div>
          ) : (
            /* Shared shopping surface — search, filters, hub slideshow slot,
               product grid and sticky cart bar. */
            <ExhibitionCatalog
              catalog={catalog}
              loading={loading}
              error={error}
              beforeGrid={
                !loading && vendorsWithProducts.length > 0 ? (
                  <ExhibitionHubs vendors={vendorsWithProducts} vendorCounts={vendorCounts} />
                ) : null
              }
            />
          )}
        </div>
      </div>
    </ProtectedRoute>
  )
}

export default function ExhibitionPage() {
  return <ExhibitionShopContent />
}
