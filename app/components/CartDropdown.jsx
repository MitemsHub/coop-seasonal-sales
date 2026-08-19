// app/components/CartDropdown.jsx
'use client'

// The navbar "Cart" control for members. One tap opens the three module carts
// (Food, Ram, Exhibition) each with its live item count, so members always see
// what is in every cart — not just the module they are currently browsing.
// Ram has no cart page: its selection lives in the shop's sticky cart bar, so
// the Ram row links back to the shop.
import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Beef, ChevronDown, ShoppingBasket, ShoppingCart, Store } from 'lucide-react'

export default function CartDropdown({ food = 0, ram = 0, exhibition = 0 }) {
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
    { href: '/cart', label: 'Food Distribution', Icon: ShoppingBasket, count: food },
    { href: '/ram/shop', label: 'Ram Sales', Icon: Beef, count: ram },
    { href: '/exhibition/cart', label: 'Coop Exhibition', Icon: Store, count: exhibition },
  ]

  const total = food + ram + exhibition

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Cart, ${total} item${total === 1 ? '' : 's'} across all shops`}
        className={[
          'inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium transition-all duration-200 lg:px-3 lg:py-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
          open ? 'bg-accent text-accent-fg shadow-md' : 'text-fg hover:bg-subtle',
        ].join(' ')}
      >
        <ShoppingCart className="h-4 w-4" strokeWidth={2} aria-hidden="true" />
        Cart
        {total > 0 && (
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold leading-none text-accent-fg ring-2 ring-surface">
            {total}
          </span>
        )}
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
            aria-label="Cart by module"
            className="absolute left-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-2xl"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted">Your carts</p>
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
                    'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
                    it.count > 0 ? 'bg-accent text-accent-fg' : 'bg-subtle text-muted',
                  ].join(' ')}
                >
                  {Number(it.count).toLocaleString()}
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
