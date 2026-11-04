// app/exhibition/vendor/[id]/page.jsx
// A single vendor's hub inside the exhibition — their stand, address and
// products. Browsing here filters the catalog to this vendor; adding items
// writes to the same exhibition cart (shared useExhibitionCart + product card,
// so this page can never drift from the shop or the all-products page).
'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { MapPin, Phone, Store } from 'lucide-react'
import ProtectedRoute from '../../../components/ProtectedRoute'
import CartStickyBar from '../../../components/CartStickyBar'
import ExhibitionCycleHint from '../../../components/ExhibitionCycleHint'
import ContinueShoppingBanner from '../../../components/ContinueShoppingBanner'
import useExhibitionCatalog from '../../../hooks/useExhibitionCatalog'
import useExhibitionCart from '../../../hooks/useExhibitionCart'
import ModuleClosedPanel from '../../../components/ModuleClosedPanel'
import Badge from '../../../components/ui/Badge'
import Skeleton from '../../../components/ui/Skeleton'
import EmptyState from '../../../components/ui/EmptyState'
import ExhibitionProductCard from '../../../components/ExhibitionProductCard'
import { useAuth } from '../../../contexts/AuthContext'

function VendorHubContent() {
  const router = useRouter()
  const params = useParams()
  const vendorId = Number(params?.id)
  const { user } = useAuth()
  const memberId = String(user?.id || '').trim().toUpperCase()

  // The stand belongs to the delivery location the member is shopping, and
  // that is what the shop persists. Without it this page fell back to the
  // member's own branch, so a stand from another branch showed "0 products"
  // even though the hub card it was opened from listed them.
  const [branchCode, setBranchCode] = useState('')
  useEffect(() => {
    if (!memberId) return
    try {
      setBranchCode(localStorage.getItem(`exhibitionDeliveryBranch_${memberId}`) || '')
    } catch {}
  }, [memberId])

  const { catalog, error, loading } = useExhibitionCatalog(branchCode)
  const { addToCart, qtyOf, cartCount, cartTotal } = useExhibitionCart()

  const vendor = useMemo(() => catalog?.vendors?.find((v) => v.id === vendorId) || null, [catalog, vendorId])
  const products = useMemo(
    () => (catalog?.products || []).filter((p) => p.vendor_id === vendorId),
    [catalog, vendorId]
  )

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

  return (
    <ProtectedRoute allowedRoles={['member']}>
      <div className="min-h-screen bg-canvas">
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative p-fluid pb-28 sm:pb-32 md:pb-36 max-w-7xl mx-auto">
          {/* Continue-shopping banner — surfaces food/ram carts here; the
              exhibition cart is already covered by the sticky cart bar. */}
          <ContinueShoppingBanner excludeModules={['exhibition']} className="mb-fluid-lg" />

          {/* Hero */}
          {!!error && (
            <div className="mb-4 rounded-xl border border-danger-border bg-danger-bg px-4 py-3 text-sm text-danger-fg">{error}</div>
          )}

          {loading ? (
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
              {Array.from({ length: 12 }).map((_, i) => (
                <Skeleton key={i} className="h-44 rounded-xl" />
              ))}
            </div>
          ) : !vendor ? (
            <EmptyState icon={Store} title="Vendor not found" description="This stand isn't part of your branch's exhibition." />
          ) : (
            <>
              {/* Vendor header */}
              <div className="ui-card mb-fluid-lg overflow-hidden">
                <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-accent-subtle text-accent">
                    <Store className="h-7 w-7" strokeWidth={2} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="font-display text-h1 font-semibold tracking-tight text-fg">{vendor.name}</h1>
                      <Badge tone="accent" variant="subtle">
                        Vendor stand
                      </Badge>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-chips text-muted">
                      {vendor.address && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="h-3 w-3" strokeWidth={2} />
                          {vendor.address}
                        </span>
                      )}
                      {vendor.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="h-3 w-3" strokeWidth={2} />
                          {vendor.phone}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="shrink-0 rounded-xl border border-line bg-canvas/60 px-4 py-2 text-center">
                    <div className="text-xl font-bold text-fg">{products.length}</div>
                    <div className="text-chips font-medium text-muted">Products</div>
                  </div>
                </div>
              </div>

              {/* Products */}
              {products.length === 0 ? (
                <EmptyState
                  icon={Store}
                  title="Stand is empty"
                  description={
                    catalog?.cycle?.starts_at || catalog?.cycle?.ends_at ? (
                      <>
                        This vendor hasn&apos;t listed products yet —{' '}
                        <ExhibitionCycleHint cycle={catalog.cycle} />. Check back soon.
                      </>
                    ) : (
                      "This vendor hasn't listed products yet."
                    )
                  }
                />
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-6 2xl:grid-cols-7">
                  {products.map((p) => (
                    <ExhibitionProductCard
                      key={p.id}
                      p={p}
                      qty={qtyOf(p.id)}
                      onAdd={(d) => addToCart(p, d)}
                      showVendor={false}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Sticky cart bar — shared component so every shopping surface stays in sync */}
        <CartStickyBar
          count={cartCount}
          total={cartTotal}
          subtitle="Negotiated prices applied where they exist"
          onGoToCart={() => router.push('/exhibition/cart')}
        />
      </div>
    </ProtectedRoute>
  )
}

export default function VendorHubPage() {
  return <VendorHubContent />
}
