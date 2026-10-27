// app/hooks/useModuleStatusToasts.js
'use client'

// Shared status-transition watcher for every member order module. Watches the
// member's orders and fires a toast when staff change an order's status, and
// records every transition into the persistent member notifications inbox.
//
// One config entry per module (MODULE_STATUS_CONFIG) — a future module only
// needs to add its poll URL, order-id accessor, snapshot key, and transition
// table; the hook logic is shared.
//
// How it works:
//   - Polls the module's slim `?status_only=1` view, but only while the member
//     is actually looking at the page, and only as fast as there is something
//     to watch (see POLLING below).
//   - Keeps a per-member snapshot of `orderId -> status` in localStorage so
//     transitions are detected across reloads and tabs without re-toasting.
//   - The first poll baselines silently (no toast for pre-existing statuses);
//     toasts only fire for transitions observed after that baseline.
//   - `missingOrderMeansCancelled` (food): the food API filters Cancelled rows
//     out of the member view, so an order that disappears was cancelled.
import { useEffect, useRef } from 'react'
import { useToast } from '../components/ui/Toast'
import recordMemberNotification from '@/lib/recordMemberNotification'

// ── Polling ───────────────────────────────────────────────────────────
// These three watchers are mounted once in the root layout, so they run for
// every signed-in member on every open tab — whether or not the member has
// any orders in that module, and whether or not the tab is even visible.
//
// The original 5s cadence therefore cost ~720 requests/member/hour per module
// (~2,160 across food + exhibition + ram), almost all of it for members with
// nothing to watch. That is what drove function invocations and observability
// events through the roof.
//
// Now: no polls at all in a hidden tab (visibilitychange wakes it up again),
// a 30s cadence while there are orders to watch, and a 5-minute cadence when
// there are none. A member who has just placed an order flips back to the
// fast cadence on the very next poll.
const ACTIVE_POLL_MS = 30_000
const IDLE_POLL_MS = 300_000

export const MODULE_STATUS_CONFIG = {
  food: {
    module: 'food',
    pollUrl: (memberId) => `/api/orders/member?member_id=${encodeURIComponent(memberId)}&status_only=1`,
    orderKey: (o) => o.order_id,
    snapshotKey: (memberId) => `foodStatus_${memberId}`,
    missingOrderMeansCancelled: true,
    transitions: {
      'Pending→Posted': {
        tone: 'success',
        event: 'posted',
        title: 'Order posted',
        message: (id) => `Your food order ${id} was posted. Your branch has it ready.`,
      },
      'Posted→Delivered': {
        tone: 'success',
        event: 'delivered',
        title: 'Order delivered',
        message: (id) => `Your food order ${id} was delivered. Pick it up from your branch rep.`,
      },
      'Pending→Delivered': {
        tone: 'success',
        event: 'delivered',
        title: 'Order delivered',
        message: (id) => `Your food order ${id} was delivered. Pick it up from your branch rep.`,
      },
      'Pending→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your food order ${id} was cancelled. Contact your branch rep if this was unexpected.`,
      },
      'Posted→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your posted food order ${id} was cancelled. Contact your branch rep if this was unexpected.`,
      },
      'Cancelled→Pending': {
        tone: 'info',
        event: 'restored',
        title: 'Order restored',
        message: (id) => `Your cancelled food order ${id} was restored and is pending again.`,
      },
      // Admin rollbacks — treat as informational, not alarming.
      'Posted→Pending': {
        tone: 'info',
        event: 'rolled-back',
        title: 'Order moved back',
        message: (id) => `Your food order ${id} was moved back to pending.`,
      },
      'Delivered→Posted': {
        tone: 'info',
        event: 'rolled-back',
        title: 'Order moved back',
        message: (id) => `Your food order ${id} was moved back to posted.`,
      },
    },
  },
  exhibition: {
    module: 'exhibition',
    pollUrl: (memberId) => `/api/exhibition/orders?member_id=${encodeURIComponent(memberId)}&status_only=1`,
    orderKey: (o) => o.order_id,
    snapshotKey: (memberId) => `exhibitionStatus_${memberId}`,
    transitions: {
      'Pending→Approved': {
        tone: 'success',
        event: 'approved',
        title: 'Order approved',
        message: (id) => `Your exhibition order ${id} was approved. The vendor has your items ready for pickup.`,
      },
      'Pending→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your exhibition order ${id} was cancelled. Contact your branch rep if this was unexpected.`,
      },
      'Approved→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your exhibition order ${id} was cancelled after approval. Contact your branch rep if this was unexpected.`,
      },
      'Cancelled→Pending': {
        tone: 'info',
        event: 'restored',
        title: 'Order restored',
        message: (id) => `Your cancelled exhibition order ${id} was restored and is pending again.`,
      },
    },
  },
  ram: {
    module: 'ram',
    pollUrl: (memberId) => `/api/ram/orders?member_id=${encodeURIComponent(memberId)}&status_only=1`,
    orderKey: (o) => o.id,
    snapshotKey: (memberId) => `ramStatus_${memberId}`,
    transitions: {
      'Pending→Approved': {
        tone: 'success',
        event: 'approved',
        title: 'Order approved',
        message: (id) => `Your ram order #${id} was approved. It is ready for collection at your delivery location.`,
      },
      'Pending→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your ram order #${id} was cancelled. Contact your branch rep if this was unexpected.`,
      },
      'Approved→Cancelled': {
        tone: 'warning',
        event: 'cancelled',
        title: 'Order cancelled',
        message: (id) => `Your ram order #${id} was cancelled after approval. Contact your branch rep if this was unexpected.`,
      },
      'Approved→Delivered': {
        tone: 'success',
        event: 'delivered',
        title: 'Order delivered',
        message: (id) => `Your ram order #${id} was delivered. Thank you for shopping with the Coop.`,
      },
      'Cancelled→Pending': {
        tone: 'info',
        event: 'restored',
        title: 'Order restored',
        message: (id) => `Your cancelled ram order #${id} was restored and is pending again.`,
      },
    },
  },
}

function readSnapshot(key) {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function writeSnapshot(key, snap) {
  try {
    localStorage.setItem(key, JSON.stringify(snap))
  } catch {
    // Best-effort — the poll still works within this session without storage.
  }
}

export default function useModuleStatusToasts(moduleName, memberId, opts = {}) {
  const cfg = MODULE_STATUS_CONFIG[moduleName]
  const pollMs = opts.pollMs ?? ACTIVE_POLL_MS
  const toast = useToast()
  const busyRef = useRef(false)

  useEffect(() => {
    if (!cfg || !memberId) return undefined

    let disposed = false
    let timer = null
    // Orders seen on the last successful poll; null until the first one lands.
    let watching = null

    const check = async () => {
      if (busyRef.current) return
      busyRef.current = true
      try {
        const res = await fetch(cfg.pollUrl(memberId), {
          cache: 'no-store',
        })
        const json = await res.json().catch(() => null)
        if (!res.ok || !json?.ok || disposed) return

        const current = {}
        for (const o of json.orders || []) current[String(cfg.orderKey(o))] = o.status
        watching = Object.keys(current).length

        const prev = readSnapshot(cfg.snapshotKey(memberId))
        if (prev) {
          const fire = (transition, orderId) => {
            const message = transition.message(orderId)
            if (transition.tone === 'success') toast.success(message)
            else if (transition.tone === 'warning') toast.warning(message)
            else toast.info(message)
            recordMemberNotification({
              module: cfg.module,
              memberId,
              orderId,
              event: transition.event,
              title: transition.title,
              message,
            })
          }

          // Modules whose API filters Cancelled rows out of the member view
          // (food): an order that previously existed and is now missing was
          // cancelled.
          if (cfg.missingOrderMeansCancelled) {
            for (const [orderId, oldStatus] of Object.entries(prev)) {
              if (current[orderId] !== undefined) continue
              if (oldStatus === 'Cancelled') continue
              const transition = cfg.transitions[`${oldStatus}→Cancelled`]
              if (!transition) continue
              fire(transition, orderId)
            }
          }

          for (const [orderId, newStatus] of Object.entries(current)) {
            const oldStatus = prev[orderId]
            if (!oldStatus || oldStatus === newStatus) continue
            const transition = cfg.transitions[`${oldStatus}→${newStatus}`]
            if (!transition) continue
            fire(transition, orderId)
          }
        }

        writeSnapshot(cfg.snapshotKey(memberId), current)
      } catch {
        // The toast watcher is best-effort — never surface poll failures.
      } finally {
        busyRef.current = false
      }
    }

    // Self-scheduling instead of setInterval so the cadence can change with
    // what the member actually has outstanding. `null` means "stay asleep" —
    // the visibilitychange listener below is what wakes it back up.
    const schedule = (ms) => {
      clearTimeout(timer)
      if (disposed || ms === null) return
      timer = setTimeout(run, ms)
    }

    const nextDelay = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return null
      }
      if (watching === null) return pollMs // first poll has not succeeded yet
      return watching > 0 ? pollMs : IDLE_POLL_MS
    }

    async function run() {
      if (disposed) return
      // A hidden tab cannot show a toast — do not spend a request on it.
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(null)
        return
      }
      await check()
      schedule(nextDelay())
    }

    const onVisible = () => {
      if (typeof document === 'undefined') return
      if (document.visibilityState === 'visible') schedule(0)
    }

    run()
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisible)
      window.addEventListener('focus', onVisible)
    }

    return () => {
      disposed = true
      clearTimeout(timer)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisible)
        window.removeEventListener('focus', onVisible)
      }
    }
  }, [cfg, memberId, pollMs, toast])

  return null
}
