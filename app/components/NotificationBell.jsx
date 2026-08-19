// app/components/NotificationBell.jsx
'use client'

// Header notification bell for members — lives in the top bar like any app.
// Clicking the bell opens a dropdown panel with the persistent notifications
// inbox (order status events recorded by the status watchers), so members can
// review them long after the transient toast is gone.
import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Beef,
  Bell,
  BellRing,
  CheckCheck,
  CheckCircle2,
  Package,
  RotateCcw,
  ShoppingBag,
  Store,
  Truck,
  X,
  XCircle,
} from 'lucide-react'
import Badge from './ui/Badge'
import Button from './ui/Button'
import Skeleton from './ui/Skeleton'

const MODULE_META = {
  food: { label: 'Food', Icon: ShoppingBag },
  ram: { label: 'Ram Sales', Icon: Beef },
  exhibition: { label: 'Exhibition', Icon: Store },
}

const EVENT_META = {
  posted: { label: 'Posted', Icon: Package, tone: 'info' },
  delivered: { label: 'Delivered', Icon: Truck, tone: 'success' },
  approved: { label: 'Approved', Icon: CheckCircle2, tone: 'success' },
  cancelled: { label: 'Cancelled', Icon: XCircle, tone: 'danger' },
  restored: { label: 'Restored', Icon: RotateCcw, tone: 'brand' },
  'rolled-back': { label: 'Moved back', Icon: RotateCcw, tone: 'neutral' },
}

function timeAgo(iso) {
  try {
    const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
    if (s < 60) return 'just now'
    const m = Math.floor(s / 60)
    if (m < 60) return `${m}m ago`
    const h = Math.floor(m / 60)
    if (h < 24) return `${h}h ago`
    const d = Math.floor(h / 24)
    if (d < 7) return `${d}d ago`
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  } catch {
    return ''
  }
}

export default function NotificationBell({ memberId }) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [unread, setUnread] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  // pulse increments each time a brand-new notification lands, re-triggering
  // the badge's pop + ring animation via the keyed motion span.
  const [pulse, setPulse] = useState(0)
  const wrapRef = useRef(null)
  const seenRef = useRef(null) // { topId } of the newest notification we've loaded
  const openRef = useRef(false)

  const load = useCallback(async () => {
    if (!memberId) {
      setLoading(false)
      return
    }
    try {
      const res = await fetch(`/api/member-notifications?member_id=${encodeURIComponent(memberId)}&limit=15`, {
        cache: 'no-store',
      })
      const json = await res.json()
      if (json?.ok) {
        const list = json.notifications || []
        const topId = list[0]?.id ?? null
        // A new notification landed when the newest id changed since the last
        // fetch — the bell pulses (unless the panel is open, where the member
        // is already looking at it). The very first load only records the state.
        const prev = seenRef.current
        if (prev && topId !== null && topId !== prev.topId && !openRef.current) {
          setPulse((p) => p + 1)
        }
        seenRef.current = { topId }
        setItems(list)
        setUnread(json.unread || 0)
      }
    } catch {
      // Best-effort — the bell must never break the header.
    } finally {
      setLoading(false)
    }
  }, [memberId])

  useEffect(() => {
    setLoading(true)
    load()
    // Keep the badge fresh while the header is mounted (status watchers land
    // in the inbox at any time).
    const t = setInterval(load, 45_000)
    return () => clearInterval(t)
  }, [load])

  // Keep a ref mirror of `open` so `load` can read it without recreating the
  // callback (which would re-run the effects above).
  useEffect(() => {
    openRef.current = open
  }, [open])

  // A status watcher just recorded a new notification (all modules dispatch
  // through recordMemberNotification) — refresh immediately so the badge
  // pulses the moment it lands.
  useEffect(() => {
    const onRecorded = () => load()
    window.addEventListener('coop:member-notification', onRecorded)
    return () => window.removeEventListener('coop:member-notification', onRecorded)
  }, [load])

  // Refetch when the tab becomes visible again (returning from background,
  // switching tabs) so a stale badge from while the page was hidden is fixed
  // instantly — the top-id check will pulse if anything new landed meanwhile.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // Close on outside click and ESC while the panel is open.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    const next = !open
    setOpen(next)
    // Re-fetch when opening so the panel is never stale.
    if (next) load()
  }

  const markAllRead = async () => {
    if (!memberId || !unread) return
    setBusy(true)
    try {
      await fetch('/api/member-notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ member_id: memberId, all: true }),
      })
      setItems((prev) => prev.map((n) => ({ ...n, is_read: true })))
      setUnread(0)
    } catch {
      // Best-effort.
    } finally {
      setBusy(false)
    }
  }

  const markOneRead = async (id) => {
    if (!memberId) return
    await fetch('/api/member-notifications', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ member_id: memberId, ids: [id] }),
    }).catch(() => null)
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)))
    setUnread((u) => Math.max(0, u - 1))
  }

  return (
    <div ref={wrapRef} className="relative ml-auto lg:ml-2">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={unread > 0 ? `Notifications (${unread} unread)` : 'Notifications'}
        title={unread > 0 ? `${unread} unread notification${unread === 1 ? '' : 's'}` : 'Notifications'}
        className={[
          'relative inline-flex items-center justify-center rounded-full p-2 transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-brand/40',
          open ? 'bg-brand-subtle text-brand' : 'text-muted hover:bg-subtle hover:text-fg',
        ].join(' ')}
      >
        <Bell className="h-5 w-5" strokeWidth={2} aria-hidden="true" />
        {unread > 0 && (
          <motion.span
            key={pulse}
            className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold leading-none text-white"
            initial={false}
            animate={
              pulse > 0
                ? {
                    scale: [1.7, 1],
                    boxShadow: [
                      '0 0 0 0px rgba(220,38,38,0.55)',
                      '0 0 0 9px rgba(220,38,38,0)',
                    ],
                  }
                : { scale: 1, boxShadow: '0 0 0 0px rgba(220,38,38,0)' }
            }
            transition={{ duration: 0.65, ease: 'easeOut' }}
          >
            {unread > 9 ? '9+' : unread}
          </motion.span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Notifications"
            className="fixed inset-x-3 top-14 z-50 w-auto overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <div className="flex items-center justify-between gap-3 border-b border-line bg-surface/70 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="relative inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-subtle text-brand">
                  <Bell className="h-4 w-4" strokeWidth={2} />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate font-display text-sm font-semibold tracking-tight text-fg">Notifications</h2>
                  <p className="truncate text-chips text-muted">
                    {unread > 0 ? `${unread} unread update${unread === 1 ? '' : 's'}` : 'Order status updates'}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {unread > 0 && (
                  <Button variant="ghost" size="sm" leftIcon={CheckCheck} onClick={markAllRead} disabled={busy}>
                    Mark all read
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close notifications"
                  title="Close"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
                >
                  <X className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </button>
              </div>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-2">
              {loading ? (
                <div className="space-y-2.5 p-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-14 rounded-xl" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <BellRing className="h-8 w-8 text-muted/60" strokeWidth={1.5} />
                  <p className="text-sm font-medium text-fg">No notifications yet</p>
                  <p className="max-w-xs text-chips text-muted">
                    When your order is posted, delivered or approved, it will show up here for later.
                  </p>
                </div>
              ) : (
                <ul className="space-y-1.5">
                  {items.map((n) => {
                    const mod = MODULE_META[n.module] || MODULE_META.food
                    const ev = EVENT_META[n.event] || { label: n.event, Icon: Bell, tone: 'neutral' }
                    const ModIcon = mod.Icon
                    const EvIcon = ev.Icon
                    return (
                      <li key={n.id}>
                        <button
                          type="button"
                          onClick={() => !n.is_read && markOneRead(n.id)}
                          className={`group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                            n.is_read
                              ? 'border-line-subtle bg-subtle/30'
                              : 'border-brand/25 bg-brand-subtle/40 hover:bg-brand-subtle/70'
                          }`}
                        >
                          <span
                            className={`mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md ${
                              n.is_read ? 'bg-subtle text-muted' : 'bg-brand-subtle text-brand'
                            }`}
                          >
                            <EvIcon className="h-4 w-4" strokeWidth={2} />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                              <span className="text-sm font-semibold text-fg">{ev.label}</span>
                              <Badge tone="neutral" variant="subtle">
                                {n.order_id}
                              </Badge>
                              {!n.is_read && (
                                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-brand" aria-label="Unread" />
                              )}
                            </span>
                            <span className="mt-0.5 block text-chips text-muted">{n.message}</span>
                            <span className="mt-1 flex items-center gap-1 text-chips text-subtext">
                              <ModIcon className="h-3 w-3" strokeWidth={2} />
                              {mod.label}
                              <span aria-hidden="true">·</span>
                              {timeAgo(n.created_at)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
