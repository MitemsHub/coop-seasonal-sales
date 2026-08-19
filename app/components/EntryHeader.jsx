'use client'

// app/components/EntryHeader.jsx
// Persistent sticky header for the pre-auth entry screens (/rep/access, /rep/login,
// /admin/pin) so they share the same chrome as the rest of the product:
//  - hamburger on the LEFT (mobile) opening a slide-in drawer
//  - brand mark + contextual subtitle
//  - "Back to Portal" + theme toggle on the RIGHT
// Mirrors the LandingHeader interaction pattern (ESC close, body scroll lock,
// focus management) used on the marketing pages.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Menu, X } from 'lucide-react'
import ThemeToggle from './ui/ThemeToggle'
import useFocusTrap from '../hooks/useFocusTrap'

export default function EntryHeader({
  subtitle = 'Seasonal Sales',
  links = [],
  backLabel = 'Back to Portal',
  backHref = '/portal',
}) {
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const hamburgerRef = useRef(null)
  const panelRef = useRef(null)

  // Border/shadow once the page is scrolled
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Drawer focus management — Tab trap, focus in/restore (guarded so a fresh
  // page load never steals focus), ESC close, scroll lock, desktop release.
  useFocusTrap({
    open,
    panelRef,
    triggerRef: hamburgerRef,
    breakpoint: 1024,
    lockScroll: true,
    onClose: () => setOpen(false),
  })

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b bg-canvas/85 backdrop-blur-md transition-[border-color,box-shadow] duration-200 ${
          scrolled ? 'border-line shadow-sm' : 'border-transparent'
        }`}
      >
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 lg:h-16 lg:px-6">
          {/* Hamburger — mobile only */}
          <button
            type="button"
            ref={hamburgerRef}
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg transition-colors duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 lg:hidden"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* Brand */}
          <Link href="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
              <img src="/logo.png" alt="" className="h-7 w-7 object-contain" />
            </span>
            <span className="flex flex-col leading-tight">
              <span className="text-[15px] font-bold tracking-tight text-brand dark:text-fg">
                CBN Coop
              </span>
              <span className="text-chips text-muted">{subtitle}</span>
            </span>
          </Link>

          {/* Right — back link (desktop) + theme toggle */}
          <div className="ml-auto flex items-center gap-2">
            <Link
              href={backHref}
              className="hidden items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 sm:inline-flex"
            >
              <ArrowLeft className="h-4 w-4" />
              {backLabel}
            </Link>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Mobile drawer — slides in from the left */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />
        )}
        {open && (
          <motion.aside
            key="panel"
            ref={panelRef}
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-surface shadow-2xl lg:hidden"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'tween', duration: 0.25, ease: [0.21, 0.47, 0.32, 0.98] }}
            role="dialog"
            aria-modal="true"
            aria-label="Menu"
          >
            <div className="flex items-center justify-between border-b border-line bg-subtle/40 px-4 py-3">
              <span className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
                  <img src="/logo.png" alt="" className="h-6 w-6 object-contain" />
                </span>
                <span className="text-sm font-bold text-brand dark:text-fg">CBN Coop</span>
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-fg transition-colors duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Mobile">
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
                >
                  {l.icon && <l.icon className="h-4 w-4 text-muted" strokeWidth={2} />}
                  <span className="min-w-0 flex-1 truncate">{l.label}</span>
                  {l.badge &&
                    (l.badge.open == null ? (
                      <span className="inline-flex h-[22px] w-[66px] items-center justify-center rounded-full bg-subtle" aria-hidden="true">
                        <span className="h-3 w-11 animate-pulse rounded-full bg-muted/40" />
                      </span>
                    ) : (
                      <span
                        className={[
                          'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                          l.badge.open ? 'bg-success-bg text-success-fg' : 'bg-line/70 text-muted',
                        ].join(' ')}
                      >
                        <span className={['h-1.5 w-1.5 rounded-full', l.badge.open ? 'bg-success-fg' : 'bg-muted'].join(' ')} aria-hidden="true" />
                        {l.badge.open ? 'Opened' : 'Closed'}
                      </span>
                    ))}
                </Link>
              ))}
              <div className="my-3 h-px bg-line" />
              <Link
                href={backHref}
                onClick={() => setOpen(false)}
                className="flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
              >
                <ArrowLeft className="h-4 w-4 text-muted" />
                {backLabel}
              </Link>
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
