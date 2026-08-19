'use client'

import { AnimatePresence, motion } from 'framer-motion'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function PageTransition({ children }) {
  const pathname = usePathname()
  const [toasts, setToasts] = useState([])
  const fullBleed = pathname === '/' || pathname === '/portal' || pathname.startsWith('/admin') || pathname.startsWith('/rep')

  useEffect(() => {
    const onToast = (event) => {
      const detail = event?.detail || {}
      const text = typeof detail.text === 'string' ? detail.text.trim() : ''
      if (!text) return

      const type = detail.type === 'success' || detail.type === 'error' || detail.type === 'info' ? detail.type : 'info'
      const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
      const ttlMs = Number.isFinite(detail.ttlMs) ? Math.max(1500, Math.min(15_000, Number(detail.ttlMs))) : 4500

      setToasts((prev) => [...prev, { id, type, text }].slice(-3))
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, ttlMs)
    }

    window.addEventListener('app-toast', onToast)
    return () => window.removeEventListener('app-toast', onToast)
  }, [])

  return (
    <>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={pathname}
          initial={{ opacity: 0, y: 10, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.995 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <div className={fullBleed ? 'w-full' : 'max-w-7xl mx-auto p-2 lg:p-3 xl:p-4 pt-2 lg:pt-3 xl:pt-4'}>
            {children}
          </div>
        </motion.div>
      </AnimatePresence>

      <div className="pointer-events-none fixed inset-x-0 bottom-3 z-[60] flex justify-center px-3 sm:bottom-4">
        <div className="flex w-full max-w-md flex-col gap-2">
          <AnimatePresence initial={false}>
            {toasts.map((t) => (
              <motion.div
                key={t.id}
                initial={{ opacity: 0, y: 10, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 10, scale: 0.98 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="pointer-events-auto"
              >
                <div
                  className={`rounded-xl border px-4 py-3 text-sm shadow-xl backdrop-blur ${
                    t.type === 'success'
                      ? 'border-success-border bg-success-bg/95 text-success-fg'
                      : t.type === 'error'
                        ? 'border-danger-border bg-danger-bg/95 text-danger-fg'
                        : 'border-line-subtle bg-surface/95 text-fg'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={`mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full ${
                        t.type === 'success' ? 'bg-green-600' : t.type === 'error' ? 'bg-red-600' : 'bg-blue-600'
                      }`}
                    />
                    <div className="min-w-0 flex-1 leading-snug">{t.text}</div>
                    <button
                      type="button"
                      aria-label="Dismiss"
                      className="ml-2 rounded-md px-2 py-1 text-xs text-muted hover:bg-muted"
                      onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </>
  )
}
