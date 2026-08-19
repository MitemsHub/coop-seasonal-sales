'use client'

// app/components/ui/Toast.jsx
// Sakani toast — fixed bottom-right stack, auto-dismiss, live-region announcements.
import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckCircle2, Info, AlertTriangle, XCircle, X } from 'lucide-react'

const ToastContext = createContext(null)
let toastId = 0

const TONES = {
  success: { icon: CheckCircle2, ring: 'ring-success/30', iconColor: 'text-success', bar: 'bg-success' },
  error: { icon: XCircle, ring: 'ring-danger/30', iconColor: 'text-danger', bar: 'bg-danger' },
  warning: { icon: AlertTriangle, ring: 'ring-warning/30', iconColor: 'text-warning', bar: 'bg-warning' },
  info: { icon: Info, ring: 'ring-info/30', iconColor: 'text-info', bar: 'bg-info' },
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const timers = useRef(new Map())

  const dismiss = useCallback((id) => {
    setToasts((list) => list.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  const push = useCallback(
    (tone, message, opts = {}) => {
      const id = ++toastId
      setToasts((list) => [...list, { id, tone, message, ...opts }])
      const duration = opts.duration ?? 4200
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration)
        )
      }
      return id
    },
    [dismiss]
  )

  const toast = useCallback(
    (message, opts = {}) => push(opts.tone || 'info', message, opts),
    [push]
  )
  toast.success = useCallback((m, o = {}) => push('success', m, o), [push])
  toast.error = useCallback((m, o = {}) => push('error', m, { duration: 6000, ...o }), [push])
  toast.warning = useCallback((m, o = {}) => push('warning', m, o), [push])
  toast.info = useCallback((m, o = {}) => push('info', m, o), [push])

  return (
    <ToastContext.Provider value={toast}>
      {children}
      {/* Toast stack */}
      <div
        aria-live="assertive"
        aria-atomic="true"
        className="pointer-events-none fixed bottom-4 right-4 z-[120] flex w-[min(92vw,360px)] flex-col gap-2"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const tone = TONES[t.tone] || TONES.info
            const Icon = tone.icon
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 14, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, x: 24, scale: 0.97 }}
                transition={{ duration: 0.2, ease: [0.33, 1, 0.68, 1] }}
                className={[
                  'pointer-events-auto relative flex items-start gap-2.5 overflow-hidden rounded-xl border border-line bg-surface p-3 pr-8 shadow-lg',
                  'ring-1',
                  tone.ring,
                ].join(' ')}
              >
                <span className={['mt-0.5 shrink-0', tone.iconColor].join(' ')}>
                  <Icon className="h-4.5 w-4.5" strokeWidth={2.2} />
                </span>
                <p className="flex-1 text-sm text-fg">{t.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md text-subtext transition-colors hover:bg-subtle hover:text-fg"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
                <span className={['absolute inset-y-0 left-0 w-1', tone.bar].join(' ')} aria-hidden="true" />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}

export default ToastProvider
