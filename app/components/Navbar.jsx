// app/components/Navbar.jsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useTheme } from '../contexts/ThemeContext'
import useCartCount from '../hooks/useCartCount'
import NotificationBell from './NotificationBell'
import ShopDropdown from './ShopDropdown'
import CartDropdown from './CartDropdown'
import { AnimatePresence, motion } from 'framer-motion'
import Breadcrumbs from './ui/Breadcrumbs'
import ContinueShoppingBanner from './ContinueShoppingBanner'
import { getTrail } from '@/lib/breadcrumbs'

export default function Navbar() {
  const pathname = usePathname()
  const { user, logout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [lowCount, setLowCount] = useState(0)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // The drawer's Shop group is collapsed by default and click-only, matching
  // the portal sidebars — no section auto-expands on its own.
  const [shopOpen, setShopOpen] = useState(false)
  const [isDemandTrackingMode, setIsDemandTrackingMode] = useState(false)
  // Shopping availability state (controls the Shop dropdown dots + cart link)
  const [shoppingOpen, setShoppingOpen] = useState(false)
  const [ramOpen, setRamOpen] = useState(false)
  const [exhibitionOpen, setExhibitionOpen] = useState(false)
  const [shoppingStatusLoading, setShoppingStatusLoading] = useState(false)

  const userType = user?.type
  const hideOnAdmin = !!pathname?.startsWith('/admin')
  const hideOnRep = !!pathname?.startsWith('/rep')
  const hideOnVendor = !!pathname?.startsWith('/vendor')
  const hideOnLanding = pathname === '/' || pathname === '/portal' || pathname === '/contact'
  const hideOnPrivileged = userType === 'admin' || userType === 'rep'
  const hideNavbar = hideOnAdmin || hideOnRep || hideOnVendor || hideOnLanding || hideOnPrivileged

  const isActive = (path) => {
    if (path === '/') return pathname === '/'
    return pathname.startsWith(path)
  }

  const hideShopLink = isActive('/shop') || isActive('/cart') || isActive('/orders') || isActive('/ram') || isActive('/exhibition')

  const closeMobileMenu = () => setMobileMenuOpen(false)
  const hamburgerRef = useRef(null)
  const drawerRef = useRef(null)

  // Move focus into the drawer on open, restore it to the hamburger on close.
  useEffect(() => {
    if (mobileMenuOpen) {
      const t = setTimeout(() => drawerRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => hamburgerRef.current?.focus(), 320)
    return () => clearTimeout(t)
  }, [mobileMenuOpen])

  // ESC closes the mobile drawer
  useEffect(() => {
    if (!mobileMenuOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileMenuOpen])

  // Lock body scroll while the drawer is open
  useEffect(() => {
    if (!mobileMenuOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileMenuOpen])

  const memberId = userType === 'member' ? String(user?.id || '') : ''
  const memberIdKey = memberId ? memberId.trim().toUpperCase() : ''
  const isRamRoute = userType === 'member' && isActive('/ram')
  const isExhibitionRoute = userType === 'member' && isActive('/exhibition')

  // Cart badge — one shared hook per module owns the event/storage listeners,
  // so the Navbar and every shop surface stay in sync without repeating wiring.
  // All three modules dispatch their own event on save, so no polling is needed.
  const foodCart = useCartCount('food', { memberId: memberIdKey })
  const ramCart = useCartCount('ram', { memberId: memberIdKey })
  const exhibitionCart = useCartCount('exhibition', { memberId: memberIdKey })
  const cartCount = isRamRoute ? ramCart.count : isExhibitionRoute ? exhibitionCart.count : foodCart.count

  // Orders badges — the order pages announce after writing their count keys,
  // so these live via the same event/storage wiring as the cart badges (no poll).
  const ordersCount = useCartCount('orders', { memberId: memberIdKey }).count
  // The exhibition pending badge pulses only when a NEW order arrived since
  // the member last viewed their pending queue (ID-set freshness, matching
  // the admin switcher) — fresh is threaded through the same hook.
  const exhPendingHook = useCartCount('exhibitionPending', { memberId: memberIdKey })
  const exhPending = exhPendingHook.count
  const exhPendingFresh = exhPendingHook.fresh

  // Check demand tracking mode - only for admin
  useEffect(() => {
    if (hideNavbar) return
    if (userType !== 'admin') return
    
    const checkMode = async () => {
      try {
        const res = await fetch('/api/admin/system/mode')
        const data = await res.json()
        if (data?.ok) {
          setIsDemandTrackingMode(data.isDemandTrackingMode || false)
        }
      } catch {}
    }
    checkMode()
  }, [userType, hideNavbar])

  // Low-stock poll (every 90s) - only for admin and only in stock tracking mode
  useEffect(() => {
    if (hideNavbar) return
    if (userType !== 'admin' || isDemandTrackingMode) {
      // Reset low count when in demand tracking mode or not admin
      setLowCount(0)
      return
    }
    
    let t
    const load = async () => {
      try {
        const res = await fetch('/api/admin/inventory/low?threshold=20', { cache: 'no-store' })
        const j = await res.json()
        if (j?.ok) setLowCount(j.count || 0)
      } catch {
        setLowCount(0)
      }
      t = setTimeout(load, 90_000)
    }
    load()
    return () => t && clearTimeout(t)
  }, [userType, isDemandTrackingMode, hideNavbar])

  // Load current shopping status for all three modules — the Shop dropdown
  // shows live open/closed dots and the cart link gates on the food module.
  useEffect(() => {
    if (hideNavbar) return
    let cancelled = false
    const loadShoppingStatus = async () => {
      try {
        setShoppingStatusLoading(true)
        const [f, r, e] = await Promise.allSettled([
          fetch('/api/system/shopping', { cache: 'no-store' }),
          fetch('/api/system/ram-shopping', { cache: 'no-store' }),
          memberIdKey
            ? fetch(`/api/exhibition/catalog?member_id=${encodeURIComponent(memberIdKey)}`, { cache: 'no-store' })
            : Promise.reject(new Error('no member')),
        ])
        if (f.status === 'fulfilled') {
          const j = await f.value.json().catch(() => null)
          if (!cancelled) setShoppingOpen(!!j?.open)
        }
        if (r.status === 'fulfilled') {
          const j = await r.value.json().catch(() => null)
          if (!cancelled) setRamOpen(!!j?.open)
        }
        if (e.status === 'fulfilled') {
          const j = await e.value.json().catch(() => null)
          if (!cancelled) setExhibitionOpen(!!(j?.ok && j?.open))
        }
      } catch {
        if (!cancelled) {
          setShoppingOpen(false)
          setRamOpen(false)
          setExhibitionOpen(false)
        }
      } finally {
        if (!cancelled) setShoppingStatusLoading(false)
      }
    }
    // Only fetch for members, others don't see the Shop entry here
    if (userType === 'member') loadShoppingStatus()
    return () => { cancelled = true }
  }, [userType, hideNavbar, memberIdKey])

  if (hideNavbar) return null

  const isOrdersNav = userType === 'member' && isActive('/orders')
  const isFoodSuccessNav = userType === 'member' && isActive('/shop/success')
  const isRamSuccessNav = userType === 'member' && isActive('/ram/success')
  const isSuccessNav = isFoodSuccessNav || isRamSuccessNav
  const isFoodMemberNav = userType === 'member' && (isActive('/shop') || isActive('/cart') || isFoodSuccessNav)
  const isRamMemberNav = userType === 'member' && (isActive('/ram') || isRamSuccessNav)
  const memberCrumbs = getTrail('member', pathname)

  return (
    <>
      <header className="sticky top-0 z-50 bg-surface backdrop-blur-md border-b border-line shadow-lg">
      <div className="max-w-7xl mx-auto px-3 lg:px-4 xl:px-6 h-12 lg:h-14 flex items-center gap-2 lg:gap-4">
        {/* Mobile menu button — left */}
        <button
          ref={hamburgerRef}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="lg:hidden inline-flex items-center justify-center p-2 -ml-1 rounded-lg text-fg hover:bg-subtle transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand/40"
          aria-expanded={mobileMenuOpen}
          aria-label={mobileMenuOpen ? 'Close main menu' : 'Open main menu'}
        >
          {!mobileMenuOpen ? (
            <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <svg className="block h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </button>

        {/* Logo */}
        <Link href="/" className="flex items-center space-x-2 group">
          <div className="w-8 h-8 bg-surface border border-line-subtle rounded-lg flex items-center justify-center overflow-hidden">
            <img src="/logo.png" alt="CBN Coop" className="w-7 h-7 object-contain" />
          </div>
          <div className="flex flex-col">
            {isOrdersNav ? (
              <>
                <span className="font-bold text-[15px] sm:text-base lg:text-lg text-brand dark:text-fg leading-tight">
                  CBN Coop
                </span>
                <span className="text-xs sm:text-sm text-muted -mt-1">Member Shopping Portal</span>
              </>
            ) : isRamMemberNav ? (
              <>
                <span className="font-bold text-[15px] sm:text-base lg:text-lg text-brand dark:text-fg leading-tight">
                  Coop Ram Distribution
                </span>
                <span className="text-xs sm:text-sm text-muted -mt-1">Members Distribution Portal</span>
              </>
            ) : isFoodMemberNav ? (
              <>
                <span className="font-bold text-[15px] sm:text-base lg:text-lg text-brand dark:text-fg leading-tight">
                  Coop Food Distribution
                </span>
                <span className="text-xs sm:text-sm text-muted -mt-1">Member Shopping Portal</span>
              </>
            ) : (
              <>
                <span className="font-bold text-[15px] sm:text-base lg:text-lg text-brand dark:text-fg leading-tight">
                  CBN Coop
                </span>
                <span className="text-xs sm:text-sm text-muted -mt-1">Seasonal Sales</span>
              </>
            )}
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="ml-auto hidden lg:flex items-center gap-2">
          {/* Member Navigation */}
          {userType === 'member' && (
            <>
              <Link
                href="/my-coop"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/my-coop')
                    ? 'bg-brand text-on-accent shadow-md'
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                My Coop
              </Link>
              {!isSuccessNav && (
                <>
                  {!hideShopLink && (
                    <ShopDropdown
                      shoppingOpen={shoppingOpen}
                      ramOpen={ramOpen}
                      exhibitionOpen={exhibitionOpen}
                    />
                  )}
                  <div className="inline-flex items-center">
                    <Link
                      href={isRamRoute ? '/orders?tab=ram' : '/orders'}
                      className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                        isActive('/orders')? 'bg-accent text-accent-fg shadow-md' 
                          : 'text-fg hover:bg-subtle'
                      }`}
                    >
                      <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Orders ({Number.isFinite(Number(ordersCount)) ? Number(ordersCount) : 0})
                    </Link>
                    {exhPending > 0 && (
                      <Link
                        href="/orders?tab=exhibition&status=Pending"
                        title={exhPendingFresh ? 'New exhibition orders awaiting approval — view them' : 'Exhibition orders awaiting approval — view them'}
                        aria-label={`${exhPending} exhibition orders awaiting approval — view them`}
                        className={[
                          '-ml-1.5 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-all duration-200 hover:bg-warning hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40',
                          exhPendingFresh
                            ? 'animate-pulse bg-warning text-white ring-2 ring-warning/50'
                            : 'bg-warning-bg text-warning-fg ring-1 ring-warning-border',
                        ].join(' ')}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full bg-current ${exhPendingFresh ? 'animate-pulse' : ''}`} aria-hidden="true" />
                        {exhPending} pending
                      </Link>
                    )}
                  </div>
                  <CartDropdown
                    food={Number.isFinite(Number(foodCart.count)) ? Number(foodCart.count) : 0}
                    ram={Number.isFinite(Number(ramCart.count)) ? Number(ramCart.count) : 0}
                    exhibition={Number.isFinite(Number(exhibitionCart.count)) ? Number(exhibitionCart.count) : 0}
                  />
                </>
              )}
              <button
                onClick={logout}
                className="inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </>
          )}

          {/* Rep Navigation */}
          {userType === 'rep' && (
            <>
              <Link
                href="/rep/pending"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/rep/pending') 
                    ? 'bg-success-fg text-on-accent shadow-md' 
                    : 'text-fg hover:bg-success-bg hover:text-success-fg'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pending
              </Link>
              <Link
                href="/rep/posted"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/rep/posted') 
                    ? 'bg-success-fg text-on-accent shadow-md' 
                    : 'text-fg hover:bg-success-bg hover:text-success-fg'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Posted
              </Link>
              <Link
                href="/rep/delivered"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/rep/delivered') 
                    ? 'bg-success-fg text-on-accent shadow-md' 
                    : 'text-fg hover:bg-success-bg hover:text-success-fg'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Delivered
              </Link>
              <button
                onClick={logout}
                className="inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </>
          )}

          {/* Admin Navigation */}
          {userType === 'admin' && (
            <>
              <Link
                href="/admin"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  pathname === '/admin'
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3m10-11v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
                Dashboard
              </Link>
              <Link
                href="/admin/food/pending"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/pending') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pending
              </Link>
              <Link
                href="/admin/food/posted"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/posted') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Posted
              </Link>
              <Link
                href="/admin/food/delivered"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/delivered') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Delivered
              </Link>
              <Link
                href="/admin/food/import"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/import') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3 3m0 0l3-3m-3 3V10" />
                </svg>
                Import
              </Link>
              <Link
                href="/admin/food/inventory"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/inventory') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                </svg>
                Inventory
                {!isDemandTrackingMode && lowCount > 0 && (
                  <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs bg-danger-fg text-on-accent rounded-full animate-pulse">
                    {lowCount}
                  </span>
                )}
              </Link>
              <Link
                href="/admin/food/markups"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/markups') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-2.21 0-4 1.343-4 3s1.79 3 4 3 4-1.343 4-3-1.79-3-4-3zm0-5v5m0 6v5" />
                </svg>
                Markups
              </Link>
              <Link
                href="/admin/food/reports"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/reports') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
                Reports
              </Link>
              <Link
                href="/admin/food/data-management"
                className={`inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium transition-all duration-200 ${
                  isActive('/admin/food/data-management') 
                    ? 'bg-brand text-on-accent shadow-md' 
                    : 'text-fg hover:bg-brand-subtle hover:text-brand'
                }`}
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" />
                </svg>
                Data
              </Link>
              <button
                onClick={logout}
                className="inline-flex items-center px-2 lg:px-3 py-1 lg:py-1.5 rounded-full text-sm font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Logout
              </button>
            </>
          )}

          {/* No user logged in - show login options */}
          {!userType && (
            <Link
              href="/"
              className={`inline-flex items-center px-4 py-2 rounded-full text-sm font-medium transition-all duration-200 ${
                pathname === '/' 
                  ? 'bg-brand text-on-accent shadow-md' 
                  : 'text-fg hover:bg-info-bg hover:text-info-fg'
              }`}
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
              Home
            </Link>
          )}
        </nav>

        {/* Notification bell — members only */}
        {userType === 'member' && <NotificationBell memberId={memberIdKey} />}

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="ml-2 inline-flex items-center justify-center p-2 rounded-full text-muted hover:text-fg hover:bg-subtle transition-all duration-200"
          aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
        >
          {theme === 'dark' ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>

      </div>

      {/* Linked breadcrumb trail — member routes (matches the admin/rep top bars) */}
      {userType === 'member' && memberCrumbs && (
        <div className="border-t border-line/60 bg-surface/70">
          <div className="mx-auto max-w-7xl px-3 py-1.5 lg:px-4 xl:px-6">
            <Breadcrumbs items={memberCrumbs} />
          </div>
        </div>
      )}
      </header>

      {/* Mobile Navigation Drawer — slides in from the left */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            key="overlay"
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm lg:hidden"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={closeMobileMenu}
            aria-hidden="true"
          />
        )}
        {mobileMenuOpen && (
          <motion.aside
            key="panel"
            ref={drawerRef}
            tabIndex={-1}
            className="fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] overflow-y-auto bg-surface shadow-2xl lg:hidden"
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'tween', duration: 0.25, ease: [0.21, 0.47, 0.32, 0.98] }}
              role="dialog"
              aria-modal="true"
              aria-label="Main menu"
            >
              <div className="sticky top-0 flex items-center justify-between border-b border-line bg-surface px-4 py-3">
                <span className="flex items-center gap-2">
                  <span className="w-8 h-8 bg-surface border border-line-subtle rounded-lg flex items-center justify-center overflow-hidden">
                    <img src="/logo.png" alt="CBN Coop" className="w-7 h-7 object-contain" />
                  </span>
                  <span className="text-sm font-bold text-brand dark:text-fg">CBN Coop</span>
                </span>
                <button
                  onClick={closeMobileMenu}
                  className="inline-flex items-center justify-center p-2 rounded-lg text-fg hover:bg-subtle focus:outline-none focus:ring-2 focus:ring-brand/40"
                  aria-label="Close menu"
                >
                  <svg className="block h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Current location — the breadcrumb trail shown at the top of the drawer */}
              {userType === 'member' && memberCrumbs && (
                <div className="border-b border-line bg-canvas/60 px-4 py-2">
                  <Breadcrumbs items={memberCrumbs} label="Menu location" />
                </div>
              )}

              <div className="px-3 py-3 space-y-1">
            {/* Member Mobile Navigation */}
            {userType === 'member' && (
              <>
                {/* Compact continue-shopping line — members see their unfinished
                    cart (any module) before tapping into one. */}
                <ContinueShoppingBanner compact onNavigate={closeMobileMenu} className="mb-1" />
                <Link
                  href="/my-coop"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/my-coop')
                      ? 'bg-brand text-on-accent'
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  My Coop
                </Link>
                {!isSuccessNav && (
                  <>
                {!hideShopLink && (
                  <div className="px-2 pt-1">
                    <button
                      type="button"
                      onClick={() => setShopOpen((v) => !v)}
                      aria-expanded={shopOpen}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted transition-colors duration-200 hover:bg-subtle hover:text-fg"
                    >
                      Shop
                      <svg
                        className={['h-4 w-4 transition-transform duration-200', shopOpen ? 'rotate-180' : ''].join(' ')}
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {shopOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {[
                          { href: '/shop', label: 'Food Distribution', open: shoppingOpen },
                          { href: '/ram/shop', label: 'Ram Sales', open: ramOpen },
                          { href: '/exhibition', label: 'Coop Exhibition', open: exhibitionOpen },
                        ].map((m) => (
                          <Link
                            key={m.href}
                            href={m.href}
                            onClick={closeMobileMenu}
                            className={`flex items-center justify-between gap-2 rounded-md px-3 py-2 text-base font-medium transition-all duration-200 ${
                              isActive(m.href)
                                ? 'bg-brand text-on-accent'
                                : 'text-fg hover:bg-info-bg hover:text-info-fg'
                            }`}
                          >
                            <span>{m.label}</span>
                            <span
                              className={[
                                'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold',
                                m.open ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
                              ].join(' ')}
                            >
                              <span
                                className={['h-1.5 w-1.5 rounded-full', m.open ? 'bg-success-fg' : 'bg-warning'].join(' ')}
                                aria-hidden="true"
                              />
                              {m.open ? 'Open' : 'Closed'}
                            </span>
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                    <div className="flex items-center gap-1">
                      <Link
                        href={isRamRoute ? '/orders?tab=ram' : '/orders'}
                        onClick={closeMobileMenu}
                        className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                          isActive('/orders')? 'bg-accent text-accent-fg' 
                            : 'text-fg hover:bg-subtle'
                        }`}
                      >
                        Orders ({Number.isFinite(Number(ordersCount)) ? Number(ordersCount) : 0})
                      </Link>
                      {exhPending > 0 && (
                        <Link
                          href="/orders?tab=exhibition&status=Pending"
                          onClick={closeMobileMenu}
                          title={exhPendingFresh ? 'New exhibition orders awaiting approval — view them' : 'Exhibition orders awaiting approval — view them'}
                          aria-label={`${exhPending} exhibition orders awaiting approval — view them`}
                          className={[
                            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold leading-none transition-all duration-200 hover:bg-warning hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40',
                            exhPendingFresh
                              ? 'animate-pulse bg-warning text-white ring-2 ring-warning/50'
                              : 'bg-warning-bg text-warning-fg ring-1 ring-warning-border',
                          ].join(' ')}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full bg-current ${exhPendingFresh ? 'animate-pulse' : ''}`} aria-hidden="true" />
                          {exhPending} pending
                        </Link>
                      )}
                    </div>
                    <div className="px-2 pt-1">
                      <p className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted">Your carts</p>
                      <div className="space-y-0.5">
                        {[
                          { href: '/cart', label: 'Food Cart', count: Number.isFinite(Number(foodCart.count)) ? Number(foodCart.count) : 0 },
                          { href: '/ram/shop', label: 'Ram Cart', count: Number.isFinite(Number(ramCart.count)) ? Number(ramCart.count) : 0 },
                          { href: '/exhibition/cart', label: 'Exhibition Cart', count: Number.isFinite(Number(exhibitionCart.count)) ? Number(exhibitionCart.count) : 0 },
                        ].map((c) => (
                          <Link
                            key={c.href}
                            href={c.href}
                            onClick={closeMobileMenu}
                            className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-base font-medium text-fg transition-all duration-200 hover:bg-subtle"
                          >
                            <span>{c.label}</span>
                            <span
                              className={[
                                'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
                                c.count > 0 ? 'bg-accent text-accent-fg' : 'bg-subtle text-muted',
                              ].join(' ')}
                            >
                              {Number(c.count).toLocaleString()}
                            </span>
                          </Link>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                <button
                  onClick={() => { logout(); closeMobileMenu(); }}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
                >
                  Logout
                </button>
              </>
            )}

            {/* Rep Mobile Navigation */}
            {userType === 'rep' && (
              <>
                <Link
                  href="/rep/pending"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/rep/pending') 
                      ? 'bg-success-fg text-on-accent' 
                      : 'text-fg hover:bg-success-bg hover:text-success-fg'
                  }`}
                >
                  Pending
                </Link>
                <Link
                  href="/rep/posted"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/rep/posted') 
                      ? 'bg-success-fg text-on-accent' 
                      : 'text-fg hover:bg-success-bg hover:text-success-fg'
                  }`}
                >
                  Posted
                </Link>
                <Link
                  href="/rep/delivered"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/rep/delivered') 
                      ? 'bg-success-fg text-on-accent' 
                      : 'text-fg hover:bg-success-bg hover:text-success-fg'
                  }`}
                >
                  Delivered
                </Link>
                <button
                  onClick={() => { logout(); closeMobileMenu(); }}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
                >
                  Logout
                </button>
              </>
            )}

            {/* Admin Mobile Navigation */}
            {userType === 'admin' && (
              <>
                <Link
                  href="/admin"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    pathname === '/admin'
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Dashboard
                </Link>
                <Link
                  href="/admin/food/pending"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/pending') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Pending
                </Link>
                <Link
                  href="/admin/food/posted"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/posted') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Posted
                </Link>
                <Link
                  href="/admin/food/delivered"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/delivered') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Delivered
                </Link>
                <Link
                  href="/admin/food/import"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/import') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Import
                </Link>
                <Link
                  href="/admin/food/inventory"
                  onClick={closeMobileMenu}
                  className={`flex items-center px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/inventory') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Inventory
                  {!isDemandTrackingMode && lowCount > 0 && (
                    <span className="ml-2 inline-flex items-center justify-center w-5 h-5 text-xs bg-danger-fg text-on-accent rounded-full animate-pulse">
                      {lowCount}
                    </span>
                  )}
                </Link>
                <Link
                  href="/admin/food/markups"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/markups') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Markups
                </Link>
                <Link
                  href="/admin/food/reports"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/reports') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Reports
                </Link>
                <Link
                  href="/admin/food/data-management"
                  onClick={closeMobileMenu}
                  className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                    isActive('/admin/food/data-management') 
                      ? 'bg-brand text-on-accent' 
                      : 'text-fg hover:bg-brand-subtle hover:text-brand'
                  }`}
                >
                  Data Management
                </Link>
                <button
                  onClick={() => { logout(); closeMobileMenu(); }}
                  className="block w-full text-left px-3 py-2 rounded-md text-base font-medium text-fg hover:bg-danger-bg hover:text-danger-fg transition-all duration-200"
                >
                  Logout
                </button>
              </>
            )}

            {/* No user logged in - mobile */}
            {!userType && (
              <Link
                href="/"
                onClick={closeMobileMenu}
                className={`block px-3 py-2 rounded-md text-base font-medium transition-all duration-200 ${
                  pathname === '/' 
                    ? 'bg-brand text-on-accent' 
                    : 'text-fg hover:bg-info-bg hover:text-info-fg'
                }`}
              >
                Home
              </Link>
            )}
              </div>
            </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
