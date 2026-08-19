// app/components/ShopDropdown.jsx
'use client'

// The navbar "Shop" control for members. A single tap opens the three modules
// (Food, Ram, Exhibition) with their live open/closed dot, so members can jump
// straight into any shop instead of only the food one. Closed modules navigate
// to their page, which shows the shared closed panel.
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Beef, ChevronDown, ShoppingBasket, Store } from 'lucide-react'

export default function ShopDropdown({ shoppingOpen, ramOpen, exhibitionOpen }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside click and ESC while the menu is open.
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

  const items = [
    { href: '/shop', label: 'Food Distribution', Icon: ShoppingBasket, open: shoppingOpen },
    { href: '/ram/shop', label: 'Ram Sales', Icon: Beef, open: ramOpen },
    { href: '/exhibition', label: 'Coop Exhibition', Icon: Store, open: exhibitionOpen },
  ]

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Shop modules"
        className={[
          'inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium transition-all duration-200 lg:px-3 lg:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          open ? 'bg-brand text-on-accent shadow-md' : 'text-fg hover:bg-info-bg hover:text-info-fg',
        ].join(' ')}
      >
        <ShoppingBasket className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Shop
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            aria-label="Shop modules"
            className="absolute left-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {items.map((it) => (
              <Link
                key={it.href}
                href={it.href}
                role="menuitem"
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-fg transition-colors hover:bg-subtle"
              >
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-subtle text-brand">
                  <it.Icon className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                <span
                  className={[
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                    it.open ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
                  ].join(' ')}
                >
                  <span className={['h-1.5 w-1.5 rounded-full', it.open ? 'bg-success-fg' : 'bg-warning'].join(' ')} aria-hidden="true" />
                  {it.open ? 'Open' : 'Closed'}
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
