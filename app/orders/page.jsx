// app/orders/page.jsx
'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  ClipboardList,
  CreditCard,
  Download,
  MapPin,
  Package,
  Receipt,
  Store,
  User,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import ProtectedRoute from '../components/ProtectedRoute'
import useCartCount from '../hooks/useCartCount'
import { ExhibitionOrderStepper, FoodOrderStepper, RamOrderStepper } from '../components/ui/OrderStepper'
import OrderReceiptModal from '../components/OrderReceiptModal'
import { supabase } from '@/lib/supabaseClient'
import { writePendingIds, markPendingSeen } from '../lib/exhibitionPendingBadge'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import EmptyState from '../components/ui/EmptyState'
import Select from '../components/ui/Select'
import Spinner from '../components/ui/Spinner'

// Map order status -> Sakani badge tone
const STATUS_TONES = {
  Pending: 'warning',
  Posted: 'info',
  Delivered: 'success',
  Approved: 'success',
  Cancelled: 'danger',
}

function OrdersPageContent() {
  const [orders, setOrders] = useState([])
  const [ramOrders, setRamOrders] = useState([])
  const [ramLocations, setRamLocations] = useState([])
  const [exhibitionOrders, setExhibitionOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState(null)
  const [shoppingOpen, setShoppingOpen] = useState(true)
  const [shoppingStatusLoading, setShoppingStatusLoading] = useState(false)
  const [shoppingStatusError, setShoppingStatusError] = useState('')
  // Receipt modal state — { module, order } so any order (any status) can be
  // printed or saved as PDF straight from the list.
  const [receiptOrder, setReceiptOrder] = useState(null)
  
  const router = useRouter()
  const searchParams = useSearchParams()
  const isAdmin = searchParams.get('admin') === 'true'
  const tabParam = (searchParams.get('tab') || '').trim().toLowerCase()
  const statusParam = (searchParams.get('status') || '').trim()
  const VALID_STATUSES = ['Pending', 'Approved', 'Posted', 'Delivered', 'Cancelled']
  const [activeTab, setActiveTab] = useState(
    tabParam === 'ram' ? 'ram' : tabParam === 'exhibition' ? 'exhibition' : 'food'
  )
  const [selectedStatus, setSelectedStatus] = useState(
    VALID_STATUSES.includes(statusParam) ? statusParam : 'All'
  )
  const { user, loading: authLoading } = useAuth()
  const memberId = isAdmin ? (searchParams.get('member_id') || '') : (user?.id || '')

  // Live order-badge wiring — announce after writing the count keys so the
  // Navbar's Orders badge and pending-exhibition pill update instantly.
  const { announceCart: announceOrdersCount } = useCartCount('orders', { memberId })
  const { announceCart: announceExhPending } = useCartCount('exhibitionPending', { memberId })

  useEffect(() => {
    // The ProtectedRoute gate above mounts this page only after AuthContext
    // has restored the stored member session, so a cold refresh of /orders no
    // longer races the null-user first render (which used to bounce members
    // straight back to /shop). This effect now only routes the admin-mode
    // view and loads the order lists.
    if (authLoading) return
    if (isAdmin) {
      if (!memberId) {
        router.push('/admin')
      } else {
        // Admin member-orders view — load the target member's orders so
        // deep-links like /orders?admin=true&member_id=A12345&status=Pending
        // render the filtered list instead of hanging on the loader.
        loadAll()
      }
      return
    }
    if (!memberId) {
      // Defensive only — the gate already routed unauthenticated users home.
      router.replace('/')
      return
    }
    const legacy = searchParams.get('member_id')
    if (legacy) {
      const parts = []
      if (tabParam) parts.push(`tab=${encodeURIComponent(tabParam)}`)
      if (VALID_STATUSES.includes(statusParam)) parts.push(`status=${encodeURIComponent(statusParam)}`)
      router.replace(parts.length ? `/orders?${parts.join('&')}` : '/orders')
    }
    loadAll()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, memberId, router, searchParams, tabParam, authLoading])

  useEffect(() => {
    setActiveTab(tabParam === 'ram' ? 'ram' : tabParam === 'exhibition' ? 'exhibition' : 'food')
  }, [tabParam])

  // Keep the status filter in sync with ?status= (used by the Navbar's
  // pending-exhibition shortcut and the admin deep-links). Unknown/empty
  // values fall back to All.
  useEffect(() => {
    setSelectedStatus(VALID_STATUSES.includes(statusParam) ? statusParam : 'All')
  }, [statusParam])

  // Append the current status filter to a base orders URL, so tab switches
  // and the status select keep the URL deep-linkable (admins can link
  // straight to a member's pending orders, e.g.
  // /orders?admin=true&member_id=A12345&status=Pending).
  const ordersUrl = (tab, status) => {
    const parts = []
    if (isAdmin) {
      parts.push(`member_id=${encodeURIComponent(memberId)}`)
      parts.push('admin=true')
    }
    if (tab) parts.push(`tab=${encodeURIComponent(tab)}`)
    const st = status || selectedStatus
    if (st && st !== 'All' && VALID_STATUSES.includes(st)) parts.push(`status=${encodeURIComponent(st)}`)
    return parts.length ? `/orders?${parts.join('&')}` : '/orders'
  }

  const changeStatus = (value) => {
    setSelectedStatus(value)
    router.push(ordersUrl(activeTab, value))
  }

  useEffect(() => {
    let cancelled = false
    const loadStatus = async () => {
      try {
        setShoppingStatusLoading(true)
        setShoppingStatusError('')
        const res = await fetch('/api/system/shopping', { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok || !json.ok) throw new Error(json.error || 'Failed to load shopping status')
        if (!cancelled) setShoppingOpen(!!json.open)
      } catch (e) {
        if (!cancelled) setShoppingStatusError(`Error: ${e.message}`)
        if (!cancelled) setShoppingOpen(false)
      } finally {
        if (!cancelled) setShoppingStatusLoading(false)
      }
    }
    loadStatus()
    return () => { cancelled = true }
  }, [])

  const loadFoodOrders = async () => {
    try {
      const res = await fetch(`/api/orders/member?member_id=${memberId}`, {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache'
        }
      })
      const data = await res.json()
      
      if (data.ok) {
        setOrders(data.orders || [])
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load orders' })
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' })
    }
  }

  const loadRamOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('ram_orders')
        .select(
          'id,member_id,status,created_at,payment_option,qty,unit_price,principal_amount,interest_amount,total_amount,ram_delivery_location_id'
        )
        .eq('member_id', memberId)
        .order('created_at', { ascending: false })

      if (error) throw new Error(error.message || 'Failed to load ram orders')
      const rows = Array.isArray(data) ? data : []
      setRamOrders(rows)

      const ids = Array.from(new Set(rows.map((r) => r?.ram_delivery_location_id).filter((x) => x != null)))
      if (ids.length === 0) {
        setRamLocations([])
        return
      }

      const { data: locs, error: lErr } = await supabase
        .from('ram_delivery_locations')
        .select('id,delivery_location,name')
        .in('id', ids)

      if (lErr) throw new Error(lErr.message || 'Failed to load ram delivery locations')
      setRamLocations(Array.isArray(locs) ? locs : [])
    } catch (e) {
      setMessage({ type: 'error', text: e?.message || 'Failed to load ram orders' })
    }
  }

  const loadExhibitionOrders = async () => {
    try {
      const res = await fetch(`/api/exhibition/orders?member_id=${encodeURIComponent(memberId)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      if (data.ok) {
        setExhibitionOrders(data.orders || [])
      } else if (String(data.error || '').toLowerCase().includes('not set up')) {
        // Exhibition isn't configured yet — treat as an empty tab, not an error.
        setExhibitionOrders([])
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load exhibition orders' })
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error. Please try again.' })
    }
  }

  const loadAll = async () => {
    try {
      setLoading(true)
      setMessage(null)
      await Promise.all([loadFoodOrders(), loadRamOrders(), loadExhibitionOrders()])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    try {
      if (!memberId) return
      const total =
        Number(orders?.length || 0) + Number(ramOrders?.length || 0) + Number(exhibitionOrders?.length || 0)
      localStorage.setItem(`ordersCount_${memberId}`, String(total))
      announceOrdersCount(total)
    } catch {}
  }, [memberId, orders?.length, ramOrders?.length, exhibitionOrders?.length, announceOrdersCount])

  // Pending exhibition orders — feeds the Navbar's "awaiting approval" badge.
  // The member is viewing the orders page, so the current pending queue is
  // marked as SEEN (fresh = false) — the badge only pulses when a genuinely
  // new pending order arrives while they're elsewhere.
  useEffect(() => {
    try {
      if (!memberId) return
      const pendingOrders = (exhibitionOrders || []).filter((o) => o.status === 'Pending')
      const pending = pendingOrders.length
      const ids = pendingOrders.map((o) => o.order_id)
      localStorage.setItem(`exhibitionPending_${memberId}`, String(pending))
      writePendingIds(memberId, ids)
      markPendingSeen(memberId, ids)
      announceExhPending({ qty: pending, fresh: false })
    } catch {}
  }, [memberId, exhibitionOrders, announceExhPending])

  const listForTab = activeTab === 'ram' ? ramOrders : activeTab === 'exhibition' ? exhibitionOrders : orders
  const filteredOrders =
    selectedStatus === 'All' ? listForTab : listForTab.filter((order) => order.status === selectedStatus)

  const ramLocationMap = new Map(ramLocations.map((l) => [String(l.id), l]))

  const formatDate = (d) =>
    new Date(d).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <div className="text-center">
          <div className="mx-auto mb-3 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-subtle shadow-xs">
            <Spinner size={20} className="text-brand" />
          </div>
          <p className="text-sm text-muted">Loading orders…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-canvas">
        {/* Ambient canvas glows (Sakani) */}
        <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
          <div className="absolute -top-32 -left-24 h-80 w-80 rounded-full bg-brand/10 blur-3xl" />
          <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-6xl p-3 pb-16 sm:p-4 md:p-6">
          {/* Hero */}
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-brand-subtle px-fluid-xs py-fluid-2xs text-chips font-semibold uppercase tracking-wide text-brand-fg">
                <ClipboardList className="h-3.5 w-3.5" strokeWidth={2.2} />
                Order History
              </div>
              <h1 className="mt-1.5 font-display text-[1.0625rem] font-semibold tracking-tight text-fg sm:text-h1">
                {isAdmin ? 'Member Orders' : 'My Orders'}
              </h1>
              <p className="mt-1 text-sm text-muted">
                {isAdmin ? 'Viewing orders for member' : 'Track your order history and status'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Food / Ram tabs */}
              <div role="tablist" aria-label="Order type" className="inline-flex rounded-xl bg-subtle p-1">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'food'}
                  onClick={() => router.push(ordersUrl('food'))}
                  className={[
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-200 ease-sakani sm:text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                    activeTab === 'food' ? 'bg-brand text-on-accent shadow-xs' : 'text-muted hover:text-fg',
                  ].join(' ')}
                >
                  <Package className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Food Orders
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'ram'}
                  onClick={() => router.push(ordersUrl('ram'))}
                  className={[
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-200 ease-sakani sm:text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                    activeTab === 'ram' ? 'bg-accent text-accent-fg shadow-xs' : 'text-muted hover:text-fg',
                  ].join(' ')}
                >
                  <Receipt className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Ram Orders
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === 'exhibition'}
                  onClick={() => router.push(ordersUrl('exhibition'))}
                  className={[
                    'inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all duration-200 ease-sakani sm:text-sm',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
                    activeTab === 'exhibition' ? 'bg-accent text-accent-fg shadow-xs' : 'text-muted hover:text-fg',
                  ].join(' ')}
                >
                  <Store className="h-3.5 w-3.5" strokeWidth={2.2} />
                  Exhibition
                </button>
              </div>

              {/* Status filter */}
              <div className="flex items-center gap-2">
                <span className="whitespace-nowrap text-xs font-medium text-muted">Status</span>
                <Select
                  value={selectedStatus}
                  onChange={(e) => changeStatus(e.target.value)}
                  aria-label="Filter orders by status"
                  className="w-36"
                >
                  <option key="all" value="All">All Orders</option>
                  <option key="pending" value="Pending">Pending</option>
                  {activeTab === 'ram' ? (
                    <option key="approved" value="Approved">Approved</option>
                  ) : activeTab === 'exhibition' ? (
                    <>
                      <option key="approved" value="Approved">Approved</option>
                      <option key="delivered" value="Delivered">Delivered</option>
                    </>
                  ) : (
                    <>
                      <option key="posted" value="Posted">Posted</option>
                      <option key="delivered" value="Delivered">Delivered</option>
                    </>
                  )}
                  <option key="cancelled" value="Cancelled">Cancelled</option>
                </Select>
              </div>

              {isAdmin && (
                <Button
                  variant="secondary"
                  size="sm"
                  leftIcon={ArrowLeft}
                  onClick={() => router.push('/admin/food/orders')}
                >
                  Back to Admin
                </Button>
              )}
            </div>
          </div>

          {!!shoppingStatusError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning-border bg-warning-bg/60 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-fg" strokeWidth={2} />
              <p className="text-xs font-medium text-warning-fg">{shoppingStatusError}</p>
            </div>
          )}

          {/* Member info strip — admin-only: the member already knows their own
              ID, but an admin viewing on behalf needs to see whose orders they're
              looking at. */}
          {isAdmin && (
            <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface px-3 py-2.5 shadow-xs">
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                <User className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <div className="text-chips font-medium text-muted">Member ID</div>
                <div className="text-xs font-semibold text-fg sm:text-sm">{memberId}</div>
              </div>
            </div>
          )}

          {/* Orders List */}
          <div className="ui-card p-4">
            {message && (
              <div className={[
                'mb-4 rounded-lg border p-3 text-xs font-medium',
                message.type === 'success'
                  ? 'border-success-border bg-success-bg/60 text-success-fg'
                  : 'border-danger-border bg-danger-bg/60 text-danger-fg',
              ].join(' ')}>
                {message.text}
              </div>
            )}

            {filteredOrders.length === 0 ? (
              <EmptyState
                icon={Package}
                title={selectedStatus === 'All' ? 'No orders found' : `No ${selectedStatus.toLowerCase()} orders found`}
                description={
                  selectedStatus === 'All'
                    ? 'Orders you place will appear here with their current status.'
                    : 'No orders with this status yet. Try a different filter.'
                }
              >
                {!isAdmin && (
                  <Button
                    leftIcon={ArrowLeft}
                    disabled={!shoppingOpen || shoppingStatusLoading}
                    onClick={() => router.push('/shop')}
                  >
                    {shoppingOpen ? 'Back to Shop' : 'Shopping Closed'}
                  </Button>
                )}
              </EmptyState>
            ) : (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {filteredOrders.map((order) =>
                  activeTab === 'exhibition' ? (
                    <div
                      key={order.order_id}
                      className="flex flex-col rounded-2xl border border-line bg-surface p-3.5 transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-fg">Order #{order.order_id}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-chips text-muted">
                            <Calendar className="h-3 w-3" strokeWidth={2} />
                            {formatDate(order.created_at)}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONES[order.status] || 'neutral'} variant="subtle">
                          {order.status}
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-subtle/60 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1 text-chips font-medium text-muted">
                          <CreditCard className="h-3 w-3" strokeWidth={2} />
                          {order.payment_option}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-fg">₦{Number(order.total_amount || 0).toLocaleString()}</span>
                      </div>

                      {/* Pending → Approved → Delivered progress */}
                      <div className="mt-3 border-t border-line-subtle pt-3">
                        <ExhibitionOrderStepper status={order.status} />
                      </div>

                      <div className="mt-2.5 space-y-1 text-chips text-muted">
                        <div className="flex items-center gap-1.5">
                          <Store className="h-3 w-3 shrink-0" strokeWidth={2} />
                          <span className="font-medium text-fg">
                            {(order.lines || []).slice(0, 2).map((l) => `${l.qty}× ${l.product_name}`).join(', ')}
                            {(order.lines || []).length > 2 ? ` +${(order.lines || []).length - 2} more` : ''}
                          </span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Package className="h-3 w-3 shrink-0" strokeWidth={2} />
                          Items: <span className="font-medium text-fg">{order.total_qty || 0}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end border-t border-line-subtle pt-2.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={Download}
                          onClick={() => setReceiptOrder({ module: 'exhibition', order })}
                        >
                          Receipt
                        </Button>
                      </div>
                    </div>
                  ) : activeTab === 'ram' ? (
                    <div
                      key={order.id}
                      className="flex flex-col rounded-2xl border border-line bg-surface p-3.5 transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-fg">Ram Order #{order.id}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-chips text-muted">
                            <Calendar className="h-3 w-3" strokeWidth={2} />
                            {formatDate(order.created_at)}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONES[order.status] || 'neutral'} variant="subtle">
                          {order.status}
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-subtle/60 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1 text-chips font-medium text-muted">
                          <CreditCard className="h-3 w-3" strokeWidth={2} />
                          {order.payment_option}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-fg">₦{Number(order.total_amount || 0).toLocaleString()}</span>
                      </div>

                      {/* Pending → Approved → Delivered progress */}
                      <div className="mt-3 border-t border-line-subtle pt-3">
                        <RamOrderStepper status={order.status} />
                      </div>

                      <div className="mt-2.5 space-y-1 text-chips text-muted">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                          Vendor: <span className="font-medium text-fg">{ramLocationMap.get(String(order.ram_delivery_location_id))?.name || 'N/A'}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Package className="h-3 w-3 shrink-0" strokeWidth={2} />
                          Qty: <span className="font-medium text-fg">{Number(order.qty || 0)}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end border-t border-line-subtle pt-2.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={Download}
                          onClick={() => setReceiptOrder({ module: 'ram', order })}
                        >
                          Receipt
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={order.order_id}
                      className="flex flex-col rounded-2xl border border-line bg-surface p-3.5 transition-all duration-200 ease-sakani hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-fg">Order #{order.order_id}</div>
                          <div className="mt-0.5 flex items-center gap-1 text-chips text-muted">
                            <Calendar className="h-3 w-3" strokeWidth={2} />
                            {formatDate(order.created_at)}
                          </div>
                        </div>
                        <Badge tone={STATUS_TONES[order.status] || 'neutral'} variant="subtle">
                          {order.status}
                        </Badge>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-subtle/60 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1 text-chips font-medium text-muted">
                          <CreditCard className="h-3 w-3" strokeWidth={2} />
                          {order.payment_option}
                        </span>
                        <span className="text-sm font-bold tabular-nums text-fg">₦{Number(order.total_amount || 0).toLocaleString()}</span>
                      </div>

                      {/* Pending → Posted → Delivered progress */}
                      <div className="mt-3 border-t border-line-subtle pt-3">
                        <FoodOrderStepper status={order.status} />
                      </div>

                      <div className="mt-2.5 space-y-1 text-chips text-muted">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3 w-3 shrink-0" strokeWidth={2} />
                          Branch: <span className="font-medium text-fg">{order.delivery?.name || 'N/A'}</span>
                        </div>
                        <div>
                          Dept: <span className="font-medium text-fg">{order.departments?.name || order.department || 'N/A'}</span>
                        </div>
                        <div>
                          Items: <span className="font-medium text-fg">{order.order_lines?.length || 0}</span>
                        </div>
                      </div>

                      <div className="mt-3 flex items-center justify-end border-t border-line-subtle pt-2.5">
                        <Button
                          variant="secondary"
                          size="sm"
                          leftIcon={Download}
                          onClick={() => setReceiptOrder({ module: 'food', order })}
                        >
                          Receipt
                        </Button>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </div>

        {/* Print-friendly receipt — any order, any status */}
        <OrderReceiptModal
          open={!!receiptOrder}
          onClose={() => setReceiptOrder(null)}
          module={receiptOrder?.module || 'food'}
          order={receiptOrder?.order}
          memberId={memberId}
          ramLocation={
            receiptOrder?.module === 'ram' && receiptOrder?.order
              ? ramLocationMap.get(String(receiptOrder.order.ram_delivery_location_id)) || null
              : null
          }
        />
      </div>
  )
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ProtectedRoute allowedRoles={['member', 'rep', 'admin']}>
        <OrdersPageContent />
      </ProtectedRoute>
    </Suspense>
  )
}
