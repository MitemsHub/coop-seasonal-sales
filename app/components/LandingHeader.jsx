'use client'

// app/components/LandingHeader.jsx
// Shared sticky header for the auth-free marketing pages (/, /portal) so the
// guest journey feels like one product:
//  - hamburger on the LEFT (mobile), brand, desktop anchor nav, CTA
//  - theme toggle on the RIGHT
//  - mobile menu is a left slide-in drawer with overlay, ESC close,
//    body scroll lock, and focus management (in on open, back to hamburger).
//
// Pages pass their own anchor links + CTAs via props (see /portal).

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowRight, ArrowUpRight, Menu, Moon, Sun, X } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'
import useFocusTrap from '../hooks/useFocusTrap'

export const SIGNUP_URL = 'https://cbn.coop.ng/Signup'

export const LANDING_NAV = [
  { href: '#services', label: 'What we do' },
  { href: '#how', label: 'How it works' },
  { href: '#why', label: 'Why join' },
  { href: '#faq', label: 'FAQ' },
]

const DEFAULT_CTA = { label: 'Get Started', href: '/portal' }
const DEFAULT_DRAWER_SECONDARY = { label: 'Become a Member', href: SIGNUP_URL, external: true }

export default function LandingHeader({
  navLinks = LANDING_NAV,
  navLabel = 'Landing',
  cta = DEFAULT_CTA,
  drawerSecondary = DEFAULT_DRAWER_SECONDARY,
}) {
  const { theme, toggleTheme } = useTheme()
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  // Gate theme-dependent UI until mounted so SSR HTML matches the client
  // (the persisted theme is only known client-side).
  const [mounted, setMounted] = useState(false)
  const hamburgerRef = useRef(null)
  const panelRef = useRef(null)

  useEffect(() => {
    setMounted(true)
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

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])



  const ctaClass =
    'inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:bg-brand-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas'

  return (
    <>
      <header
        className={`sticky top-0 z-40 border-b bg-canvas/85 backdrop-blur-md transition-[border-color,box-shadow] duration-200 ${
          scrolled ? 'border-line shadow-sm' : 'border-transparent'
        }`}
      >
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-2 px-3 lg:h-16 lg:px-6">
        {/* Hamburger — left */}
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

        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface">
            <img src="/logo.png" alt="" className="h-7 w-7 object-contain" />
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-[15px] font-bold tracking-tight text-brand dark:text-fg">
              CBN Coop
            </span>
            <span className="text-chips text-muted">Seasonal Sales</span>
          </span>
        </Link>

        {/* Desktop anchors */}
        <nav className="ml-auto hidden items-center gap-1 lg:flex" aria-label={navLabel}>
          {navLinks.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {l.label}
            </a>
          ))}
          {cta.external ? (
            <a
              href={cta.href}
              target="_blank"
              rel="noopener noreferrer"
              className={`${ctaClass} ml-3`}
            >
              {cta.label}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </a>
          ) : (
            <Link href={cta.href} className={`${ctaClass} ml-3`}>
              {cta.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </nav>

        {/* Theme toggle — right */}
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={mounted ? (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') : undefined}
          title={mounted ? (theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode') : undefined}
          className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 lg:ml-3"
        >
          {mounted ? (
            theme === 'dark' ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />
          ) : (
            <span className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </button>
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
            aria-label="Site menu"
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
              {navLinks.map((l) => (
                <a
                  key={l.href}
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2.5 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
                >
                  {l.label}
                </a>
              ))}
              <div className="my-3 h-px bg-line" />
              {/* Explore — mirrors the footer's Explore list so mobile users
                  get the full set of destinations, not just Vendor Portal. */}
              <p className="px-3 pb-1 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted">Explore</p>
              <div className="space-y-0.5">
                <Link
                  href="/portal"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
                >
                  Member Portal
                </Link>
                <Link
                  href="/contact"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
                >
                  Contact Us
                </Link>
                <Link
                  href="/vendor"
                  onClick={() => setOpen(false)}
                  className="block rounded-lg px-3 py-2 text-sm font-medium text-fg transition-colors duration-150 hover:bg-subtle hover:text-brand"
                >
                  Vendor Portal
                </Link>
              </div>
              {cta.external ? (
                <a
                  href={cta.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:bg-brand-hover"
                >
                  {cta.label}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              ) : (
                <Link
                  href={cta.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:bg-brand-hover"
                >
                  {cta.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
              {drawerSecondary.external ? (
                <a
                  href={drawerSecondary.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-200 hover:bg-subtle"
                >
                  {drawerSecondary.label}
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              ) : (
                <Link
                  href={drawerSecondary.href}
                  onClick={() => setOpen(false)}
                  className="mt-2 flex items-center justify-center gap-2 rounded-lg border border-line bg-surface px-4 py-2.5 text-sm font-medium text-fg transition-colors duration-200 hover:bg-subtle"
                >
                  {drawerSecondary.label}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              )}
            </nav>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
