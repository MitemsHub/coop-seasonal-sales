'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { BadgePercent, ChevronDown, ClipboardCheck, Landmark, LayoutDashboard, LogOut, Menu, Package, PanelLeftClose, PanelLeftOpen, ShoppingBag, Store, X } from 'lucide-react'
import Breadcrumbs from '../components/ui/Breadcrumbs'
import ModuleClosedPanel from '../components/ModuleClosedPanel'
import { getTrail } from '@/lib/breadcrumbs'

const NAV = [
  { href: '/vendor/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vendor/deliveries', label: 'Deliveries', icon: ClipboardCheck },
  { href: '/vendor/products', label: 'Products', icon: Package },
  { href: '/vendor/markups', label: 'Prices & Markups', icon: BadgePercent },
  { href: '/vendor/orders', label: 'Orders', icon: ShoppingBag },
  { href: '/vendor/banks', label: 'Banks', icon: Landmark },
]

export default function VendorLayout({ children }) {
  const pathname = usePathname()
  const router = useRouter()
  const [profile, setProfile] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  // The exhibition module group starts collapsed and is click-only, matching
  // the admin/rep sidebars — with the open state remembered across reloads.
  const [navOpen, setNavOpen] = useState(false)
  // Desktop collapse — the vendor sidebar can be tucked to a rail of icons,
  // matching the admin/rep sidebars. The preference persists across reloads.
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const panelRef = useRef(null)

  const isLoginPage = pathname.startsWith('/vendor/login')

  // Load the session on mount and refresh it every 60s so the sidebar's cycle
  // chip tracks the admin opening/closing the vendor's season without a reload.
  useEffect(() => {
    // The login page is standalone — skip the session fetch there.
    if (isLoginPage) return
    let cancelled = false
    const refresh = async () => {
      try {
        const r = await fetch('/api/vendor/session', { cache: 'no-store' })
        if (!r.ok) return
        const j = await r.json()
        if (cancelled || !j?.ok) return
        setProfile(j)
      } catch {
        // Best-effort — keep the last known session.
      }
    }
    refresh()
    const id = setInterval(refresh, 60000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [isLoginPage])

  // Hydrate the sidebar preferences after mount (not in the useState
  // initializer) so the server and first client render agree — reading
  // localStorage during render caused a hydration mismatch on every vendor
  // page when a persisted value differed from the server default. Runs before
  // the persist effects below, so the stored values are restored.
  useEffect(() => {
    try {
      const vis = window.localStorage.getItem('vendor_sidebar_visible')
      if (vis !== null) setSidebarVisible(vis === '1')
      if (localStorage.getItem('vendor_sidebar_nav_open') === '1') setNavOpen(true)
    } catch {}
  }, [])

  // Persist the module group's open state so a reload restores it.
  useEffect(() => {
    if (navOpen) localStorage.setItem('vendor_sidebar_nav_open', '1')
    else localStorage.removeItem('vendor_sidebar_nav_open')
  }, [navOpen])

  // Persist the desktop rail preference.
  useEffect(() => {
    try {
      window.localStorage.setItem('vendor_sidebar_visible', sidebarVisible ? '1' : '0')
    } catch {}
  }, [sidebarVisible])

  // Close the drawer on Escape and lock body scroll while open
  useEffect(() => {
    if (isLoginPage || !mobileOpen) return
    const onKey = (e) => e.key === 'Escape' && setMobileOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [isLoginPage, mobileOpen])

  // The login page is standalone — render it without the portal chrome.
  // Kept after the hooks so the Rules of Hooks stay stable across navigation.
  if (isLoginPage) return children

  const doLogout = async () => {
    await fetch('/api/vendor/session', { method: 'DELETE' }).catch(() => null)
    router.push('/vendor/login')
  }

  // The vendor's exhibition season is not live (draft or closed) — show the
  // closed panel instead of the portal so vendors never land on an empty
  // catalog. Order history stays reachable so they can review past seasons.
  const isClosed = profile != null && (profile?.cycle?.status || 'draft') !== 'active'
  const isOrdersPage = pathname.startsWith('/vendor/orders')

  if (isClosed && !isOrdersPage) {
    return (
      <div className="min-h-screen bg-canvas text-fg">
        <div className="mx-auto flex min-h-screen max-w-md flex-col px-4 py-5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-on-accent shadow-sm">
                <Store className="h-4.5 w-4.5" strokeWidth={2} />
              </span>
              <div className="min-w-0 leading-tight">
                <p className="truncate text-sm font-bold text-fg">{profile?.vendor?.name || 'Vendor Portal'}</p>
                <p className="truncate text-chips text-muted">{profile?.vendor?.branch || ''}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={doLogout}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-muted transition-colors hover:border-danger-border hover:text-danger-fg"
            >
              <LogOut className="h-4 w-4" />
              Log out
            </button>
          </div>
          <div className="flex flex-1 items-center justify-center py-6">
            <ModuleClosedPanel
              variant="inline"
              module="exhibition"
              vendor
              onViewOrders={() => router.push('/vendor/orders')}
              onBack={() => router.push('/vendor/dashboard')}
            />
          </div>
        </div>
      </div>
    )
  }

  // For member/vendor portals getTrail returns the crumbs array directly.
  const crumbs = getTrail('vendor', pathname) || []
  const activeHref = NAV.find((n) => pathname === n.href || pathname.startsWith(n.href + '/'))?.href || NAV[0].href
  const cycle = profile?.cycle
  // The vendor's own cycle status, live-refreshed every 60s above.
  const cycleStatus = cycle?.status || 'draft'

  const sidebar = (isMobile, collapsed) => (
    <div className="flex h-full flex-col">
      <div className={['flex items-center gap-3 py-5', collapsed ? 'justify-center px-0' : 'px-5'].join(' ')}>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-on-accent shadow-sm">
          <Store className="h-4.5 w-4.5" strokeWidth={2} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-fg">{profile?.vendor?.name || 'Vendor Portal'}</p>
            <p className="truncate text-chips text-muted">{profile?.vendor?.branch || ''}</p>
          </div>
        )}
        {isMobile && (
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg"
          >
            <X className="h-4.5 w-4.5" />
          </button>
        )}
      </div>

      <nav className="flex-1 space-y-1 px-3" aria-label="Vendor">
        {/* Coop Exhibition module group — collapsed and click-only, matching the
            admin/rep sidebar accordion. The Open/Closed chip is hidden while the
            session loads to avoid flashing a wrong "Closed". */}
        <div>
          <button
            type="button"
            onClick={() => (collapsed ? setSidebarVisible(true) : setNavOpen((v) => !v))}
            aria-expanded={navOpen}
            title={collapsed ? (cycle ? `Exhibition cycle: ${cycle.name}` : 'Coop Exhibition') : cycle ? `Exhibition cycle: ${cycle.name}` : undefined}
            className={[
              'flex w-full items-center rounded-lg py-2 text-left transition-colors duration-150 hover:bg-subtle',
              collapsed ? 'justify-center px-0' : 'justify-between gap-2 px-3',
            ].join(' ')}
          >
            {collapsed ? (
              <span className="flex h-4 w-4 items-center justify-center rounded-md bg-subtle">
                <span
                  className={['h-1.5 w-1.5 rounded-full', cycleStatus === 'active' ? 'bg-success' : 'bg-warning'].join(' ')}
                  aria-hidden="true"
                />
              </span>
            ) : (
              <>
                <span className="flex min-w-0 items-center gap-2">
                  <Store className="h-4 w-4 shrink-0 text-brand" strokeWidth={2} />
                  <span className="truncate text-chips font-semibold uppercase tracking-wider text-fg">Coop Exhibition</span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  {profile != null && (
                    <span
                      className={[
                        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                        cycleStatus === 'active' ? 'bg-success-bg text-success-fg' : 'bg-warning-bg text-warning-fg',
                      ].join(' ')}
                    >
                      <span
                        className={['h-1.5 w-1.5 rounded-full', cycleStatus === 'active' ? 'bg-success-fg' : 'bg-warning'].join(' ')}
                      />
                      {cycleStatus === 'active' ? 'Open' : 'Closed'}
                    </span>
                  )}
                  <ChevronDown
                    className={['h-4 w-4 text-muted transition-transform duration-200', navOpen ? 'rotate-180' : ''].join(' ')}
                  />
                </span>
              </>
            )}
          </button>
          {!collapsed && navOpen && (
            <div className="mt-0.5 space-y-1">
              {NAV.map((item) => {
                const active = activeHref === item.href
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                    className={[
                      'flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors duration-150',
                      collapsed ? 'justify-center pl-0 pr-0' : 'pl-4 pr-3',
                      active ? 'bg-brand/10 text-brand' : 'text-muted hover:bg-subtle hover:text-fg',
                    ].join(' ')}
                  >
                    <item.icon className="h-4 w-4 shrink-0" strokeWidth={2} />
                    {!collapsed && item.label}
                  </Link>
                )
              })}
            </div>
          )}
        </div>
      </nav>

      <div className={['space-y-2 py-4', collapsed ? 'px-0' : 'px-5'].join(' ')}>
        <button
          type="button"
          onClick={doLogout}
          title={collapsed ? 'Logout' : undefined}
          className={[
            'flex w-full items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-muted transition-colors hover:bg-danger-bg hover:text-danger-fg',
            collapsed ? 'justify-center px-0' : 'px-3',
          ].join(' ')}
        >
          <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
          {!collapsed && 'Logout'}
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-canvas text-fg">
      {/* Desktop sidebar — collapsible to a rail of icons like the admin/rep sidebars */}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-30 hidden border-r border-line bg-surface transition-[width] duration-200 ease-sakani lg:block',
          sidebarVisible ? 'w-60' : 'w-16',
        ].join(' ')}
      >
        {sidebar(false, !sidebarVisible)}
      </aside>

      {/* Mobile drawer */}
      {mobileOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
          <aside
            ref={panelRef}
            className="fixed inset-y-0 left-0 z-50 w-72 border-r border-line bg-surface shadow-2xl lg:hidden"
          >
            {sidebar(true, false)}
          </aside>
        </>
      )}

      {/* Main column */}
      <div className={sidebarVisible ? 'lg:pl-60' : 'lg:pl-16'}>
        <header className="sticky top-0 z-20 border-b border-line bg-canvas/90 backdrop-blur">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:text-fg lg:hidden"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <button
              type="button"
              onClick={() => setSidebarVisible((v) => !v)}
              aria-label={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
              title={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
              className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:text-fg lg:inline-flex"
            >
              {sidebarVisible ? <PanelLeftClose className="h-4.5 w-4.5" /> : <PanelLeftOpen className="h-4.5 w-4.5" />}
            </button>
            <Breadcrumbs items={crumbs} />
            <button
              type="button"
              onClick={doLogout}
              aria-label="Logout"
              className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-surface text-muted transition-colors hover:border-danger-border hover:text-danger-fg lg:hidden"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
