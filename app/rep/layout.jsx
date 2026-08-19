'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '../contexts/AuthContext'
import DraggableModal from '../components/DraggableModal'
import ThemeToggle from '../components/ui/ThemeToggle'
import Breadcrumbs from '../components/ui/Breadcrumbs'
import BreadcrumbHint from '../components/ui/BreadcrumbHint'
import { getTrail } from '@/lib/breadcrumbs'
import useFocusTrap, { useIsMobileView } from '../hooks/useFocusTrap'
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Send,
  Truck,
  X,
  XCircle,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

function NavLink({ href, label, icon: Icon, active, collapsed, onNavigate, count }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : count > 0 ? `${label} · ${count} pending` : label}
      className={[
        'relative flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium',
        'transition-colors duration-200 ease-sakani',
        collapsed ? 'justify-center px-0' : 'px-3',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
        active ? 'bg-accent-subtle text-fg' : 'text-muted hover:bg-subtle hover:text-fg',
      ].join(' ')}
    >
      {active && !collapsed && (
        <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-full bg-brand" aria-hidden="true" />
      )}
      <Icon className={['h-4 w-4 shrink-0', active ? 'text-fg' : 'text-subtext'].join(' ')} strokeWidth={2} />
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && count > 0 && (
        <span
          className="ml-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning-bg px-1.5 text-[10px] font-bold leading-none text-warning-fg ring-1 ring-warning-border"
          aria-label={`${count} pending`}
        >
          {Number(count).toLocaleString()}
        </span>
      )}
    </Link>
  )
}

function GroupToggle({ open, onToggle, label, collapsed, onNavigate }) {
  return (
    <button
      type="button"
      onClick={collapsed ? onNavigate : onToggle}
      title={collapsed ? label : undefined}
      className={[
        'flex w-full items-center rounded-lg py-2 text-chips font-semibold uppercase tracking-wider',
        'transition-colors duration-200 ease-sakani',
        collapsed ? 'justify-center px-0' : 'justify-between px-3',
        open ? 'bg-subtle text-fg' : 'text-subtext hover:bg-subtle hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      ].join(' ')}
    >
      {collapsed ? (
        <span className="flex h-4 w-4 items-center justify-center rounded-md bg-subtle">
          <span className="h-1.5 w-1.5 rounded-full bg-subtext" aria-hidden="true" />
        </span>
      ) : (
        <>
          <span>{label}</span>
          <ChevronDown className={['h-3.5 w-3.5 transition-transform duration-200 ease-sakani', open ? 'rotate-180' : ''].join(' ')} />
        </>
      )}
    </button>
  )
}

function Divider() {
  return <div className="my-2 h-px bg-line-subtle" aria-hidden="true" />
}

export default function RepLayout({ children }) {
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const isLoginPage = pathname.startsWith('/rep/login') || pathname.startsWith('/rep/access')
  const portalModule = user?.module || null

  const [repPhoneLoading, setRepPhoneLoading] = useState(false)
  const [repPhoneSaving, setRepPhoneSaving] = useState(false)
  const [repPhone, setRepPhone] = useState('')
  const [repPhoneModalOpen, setRepPhoneModalOpen] = useState(false)
  const [repPhoneInput, setRepPhoneInput] = useState('')

  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Accordion module groups — all collapsed on entry; only one open at a time,
  // and only when clicked (the active page never auto-expands its section).
  const [openModule, setOpenModule] = useState(null) // 'food' | 'ram' | 'exhibition' | null
  const foodOpen = openModule === 'food'
  const ramOpen = openModule === 'ram'
  const exhOpen = openModule === 'exhibition'
  const toggleModule = (key) => setOpenModule((cur) => (cur === key ? null : key))
  // Awaiting-approval queue sizes per module — the same sources the rep
  // dashboard's quick-access tiles read, surfaced in the drawer so reps see
  // their queue before opening a page.
  const [pendingCounts, setPendingCounts] = useState({ food: 0, exhibition: 0 })
  // Whether each module is live — a closed module has no actionable queue
  // (its outstanding orders were already worked through), so its pending
  // badge is suppressed even if a stale count lingers. null = still loading.
  const [foodLive, setFoodLive] = useState(null)
  const [exhLive, setExhLive] = useState(null)

  const hamburgerRef = useRef(null)
  const sidebarRef = useRef(null)

  // Hydrate the sidebar preference after mount (not in the useState initializer)
  // so the server and first client render agree — reading localStorage during
  // render caused a hydration mismatch on every rep page when a persisted value
  // differed from the server default. Runs before the persist effect below.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem('rep_sidebar_visible')
      if (v !== null) setSidebarVisible(v === '1')
    } catch {}
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('rep_sidebar_visible', sidebarVisible ? '1' : '0')
    } catch {}
  }, [sidebarVisible])

  const activeKey = useMemo(() => {
    if (pathname === '/rep') return 'dashboard'
    if (pathname.startsWith('/rep/posted')) return 'food_posted'
    if (pathname.startsWith('/rep/delivered')) return 'food_delivered'
    if (pathname.startsWith('/rep/banks')) return 'food_banks'
    if (pathname.startsWith('/rep/ram/approved')) return 'ram_approved'
    if (pathname.startsWith('/rep/ram/delivered')) return 'ram_delivered'
    if (pathname.startsWith('/rep/ram/banks')) return 'ram_banks'
    if (pathname.startsWith('/rep/exhibition/pending')) return 'exh_pending'
    if (pathname.startsWith('/rep/exhibition/approved')) return 'exh_approved'
    if (pathname.startsWith('/rep/exhibition/delivered')) return 'exh_delivered'
    if (pathname.startsWith('/rep/exhibition/cancelled')) return 'exh_cancelled'
    if (pathname.startsWith('/rep/exhibition/banks')) return 'exh_banks'
    return ''
  }, [pathname])

  // Trail + header title come from the shared breadcrumb table (staff lookups
  // always resolve — unknown keys fall back to the portal root inside the helper).
  const { title, crumbs } = useMemo(() => getTrail('rep', activeKey), [activeKey])

  const doLogout = async () => {
    try {
      await fetch('/api/rep/session', { method: 'DELETE', credentials: 'include' }).catch(() => null)
      logout()
    } catch {
      logout()
    }
  }

  const loadRepPhone = async () => {
    if (portalModule && portalModule !== 'food') return
    setRepPhoneLoading(true)
    try {
      const res = await fetch('/api/rep/profile/phone', { cache: 'no-store', credentials: 'include' })
      const ct = res.headers.get('content-type') || ''
      const json = ct.includes('application/json') ? await res.json() : null
      if (!res.ok || !json?.ok) return
      setRepPhone(String(json.rep_phone || ''))
    } catch {} finally {
      setRepPhoneLoading(false)
    }
  }

  const saveRepPhone = async () => {
    if (repPhoneSaving) return
    setRepPhoneSaving(true)
    try {
      const res = await fetch('/api/rep/profile/phone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ rep_phone: repPhoneInput }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(json?.error || 'Failed to save')
      setRepPhone(String(json.rep_phone || ''))
      setRepPhoneModalOpen(false)
    } catch {} finally {
      setRepPhoneSaving(false)
    }
  }

  useEffect(() => {
    if (isLoginPage) return
    loadRepPhone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalModule, isLoginPage])

  // Module availability — the same public shopping flags the rep access page
  // reads, so the drawer badges never claim a pending queue for a closed module.
  useEffect(() => {
    if (isLoginPage) return
    let cancelled = false
    Promise.allSettled([
      fetch('/api/system/shopping', { cache: 'no-store' }),
      fetch('/api/system/exhibition-shopping', { cache: 'no-store' }),
    ]).then(async (results) => {
      if (cancelled) return
      const read = async (r) => {
        try {
          const j = await r.value.json()
          return j?.ok ? !!j.open : null
        } catch {
          return null
        }
      }
      const [f, e] = await Promise.all([
        results[0].status === 'fulfilled' ? read(results[0]) : null,
        results[1].status === 'fulfilled' ? read(results[1]) : null,
      ])
      if (cancelled) return
      setFoodLive(f)
      setExhLive(e)
    })
    return () => {
      cancelled = true
    }
  }, [isLoginPage])

  // Pending queue counts for the drawer nav badges — food reads the branch's
  // today-pending count (the queue the rep clears on /rep/posted), exhibition
  // reads its branch-wide pending count. Mirrors the rep dashboard tiles.
  useEffect(() => {
    if (isLoginPage) return
    const loadCounts = async () => {
      const jobs = []
      if (portalModule === 'food') {
        jobs.push(
          fetch('/api/rep/orders/stats', { cache: 'no-store', credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => (j?.ok ? j : null))
            .catch(() => null)
            .then((j) => setPendingCounts((prev) => ({ ...prev, food: Number(j?.todayPending?.count || 0) })))
        )
      }
      if (portalModule === 'exhibition') {
        jobs.push(
          fetch('/api/rep/exhibition/stats', { cache: 'no-store', credentials: 'include' })
            .then((r) => (r.ok ? r.json() : null))
            .then((j) => (j?.ok ? j : null))
            .catch(() => null)
            .then((j) => setPendingCounts((prev) => ({ ...prev, exhibition: Number(j?.statuses?.Pending?.count || 0) })))
        )
      }
      await Promise.allSettled(jobs)
    }
    loadCounts()
    const t = setInterval(loadCounts, 60_000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [portalModule, isLoginPage, pathname])

  // Focus management for the mobile drawer — Tab trap, focus in/restore, ESC,
  // and release when the viewport crosses the desktop breakpoint.
  const closeMobile = () => setMobileOpen(false)
  useFocusTrap({
    open: mobileOpen,
    panelRef: sidebarRef,
    triggerRef: hamburgerRef,
    breakpoint: 1024,
    onClose: closeMobile,
  })

  // The off-canvas sidebar is hidden on mobile while closed — make it inert so
  // it leaves the tab order and accessibility tree (it stays interactive on
  // desktop, where it is the real sidebar).
  const isMobileView = useIsMobileView(1024)

  if (isLoginPage) return children

  const isCollapsed = !sidebarVisible && !mobileOpen
  const navOnClick = () => {
    if (window.innerWidth < 1024) setMobileOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* First-run hint pointing at the clickable breadcrumb trail */}
      <BreadcrumbHint portal="rep" />

      {/* Mobile backdrop */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden" onClick={closeMobile} aria-hidden="true" />
      )}

      {/* ─── Sidebar ─── */}
      <aside
        ref={sidebarRef}
        tabIndex={-1}
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? 'true' : undefined}
        aria-label="Navigation menu"
        inert={isMobileView && !mobileOpen}
        className={[
          'fixed inset-y-0 left-0 z-50 flex w-64 shrink-0 flex-col border-r border-line bg-surface',
          'transition-[transform,width] duration-200 ease-sakani',
          'lg:static lg:z-auto',
          sidebarVisible ? 'lg:w-64' : 'lg:w-16',
          mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0',
        ].join(' ')}
      >
        {/* Brand */}
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-line px-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand text-base font-bold text-on-accent">
            R
          </span>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">Rep Console</div>
              <div className="truncate text-xs text-muted">
                {portalModule === 'ram'
                  ? 'Ram Sales'
                  : portalModule === 'exhibition'
                    ? 'Coop Exhibition'
                    : portalModule === 'food'
                      ? 'Food Distribution'
                      : 'Food Distribution & Ram Sales'}
              </div>
            </div>
          )}
          {/* Mobile close — the drawer has no other way to dismiss on phones */}
          <button
            type="button"
            onClick={closeMobile}
            aria-label="Close menu"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-subtle hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 lg:hidden"
          >
            <X className="h-5 w-5" strokeWidth={2} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <div className="space-y-0.5">
            <NavLink href="/rep" label="Dashboard" icon={LayoutDashboard} active={activeKey === 'dashboard'} collapsed={isCollapsed} onNavigate={navOnClick} />
          </div>

          <Divider />

          {portalModule === 'food' && (
            <div>
              <GroupToggle open={foodOpen} onToggle={() => toggleModule('food')} label="Food Distribution" collapsed={isCollapsed} onNavigate={() => setSidebarVisible(true)} />
              {!isCollapsed && foodOpen && (
                <div className="mt-1 space-y-0.5">
                  <NavLink href="/rep/posted" label="Posted" icon={Send} active={activeKey === 'food_posted'} collapsed={false} onNavigate={navOnClick} count={foodLive === false ? 0 : pendingCounts.food} />
                  <NavLink href="/rep/delivered" label="Delivered" icon={Truck} active={activeKey === 'food_delivered'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/banks" label="Banks" icon={Landmark} active={activeKey === 'food_banks'} collapsed={false} onNavigate={navOnClick} />
                </div>
              )}
            </div>
          )}

          {portalModule === 'ram' && (
            <div>
              <GroupToggle open={ramOpen} onToggle={() => toggleModule('ram')} label="Ram Sales" collapsed={isCollapsed} onNavigate={() => setSidebarVisible(true)} />
              {!isCollapsed && ramOpen && (
                <div className="mt-1 space-y-0.5">
                  <NavLink href="/rep/ram/approved" label="Approved" icon={CheckCircle2} active={activeKey === 'ram_approved'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/ram/delivered" label="Delivered" icon={Truck} active={activeKey === 'ram_delivered'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/ram/banks" label="Banks" icon={Landmark} active={activeKey === 'ram_banks'} collapsed={false} onNavigate={navOnClick} />
                </div>
              )}
            </div>
          )}

          {portalModule === 'exhibition' && (
            <div>
              <GroupToggle open={exhOpen} onToggle={() => toggleModule('exhibition')} label="Coop Exhibition" collapsed={isCollapsed} onNavigate={() => setSidebarVisible(true)} />
              {!isCollapsed && exhOpen && (
                <div className="mt-1 space-y-0.5">
                  <NavLink href="/rep/exhibition/pending" label="Pending" icon={Clock} active={activeKey === 'exh_pending'} collapsed={false} onNavigate={navOnClick} count={exhLive === false ? 0 : pendingCounts.exhibition} />
                  <NavLink href="/rep/exhibition/approved" label="Approved" icon={CheckCircle2} active={activeKey === 'exh_approved'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/exhibition/delivered" label="Delivered" icon={Truck} active={activeKey === 'exh_delivered'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/exhibition/cancelled" label="Cancelled" icon={XCircle} active={activeKey === 'exh_cancelled'} collapsed={false} onNavigate={navOnClick} />
                  <NavLink href="/rep/exhibition/banks" label="Banks" icon={Landmark} active={activeKey === 'exh_banks'} collapsed={false} onNavigate={navOnClick} />
                </div>
              )}
            </div>
          )}

          <Divider />

          <div className="space-y-0.5">
            <NavLink href="/portal" label="Back to Portal" icon={ArrowLeft} active={false} collapsed={isCollapsed} onNavigate={navOnClick} />
            <button
              type="button"
              onClick={doLogout}
              title={isCollapsed ? 'Logout' : undefined}
              className={[
                'flex w-full items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-muted',
                'transition-colors duration-200 ease-sakani hover:bg-danger-bg hover:text-danger',
                isCollapsed ? 'justify-center px-0' : 'px-3',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
              ].join(' ')}
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
              {!isCollapsed && <span>Logout</span>}
            </button>
          </div>
        </nav>
      </aside>

      {/* ─── Main column ─── */}
      <div className="flex min-w-0 min-h-0 flex-1 flex-col overflow-hidden">
        {/* TopBar */}
        <header className="flex h-16 shrink-0 items-center gap-3 border-b border-line bg-surface px-4 sm:px-6">
          {/* Mobile hamburger */}
          <button
            type="button"
            ref={hamburgerRef}
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg lg:hidden"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
          </button>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={() => setSidebarVisible((v) => !v)}
            className="hidden h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors hover:bg-subtle hover:text-fg lg:inline-flex"
            aria-label={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
            title={sidebarVisible ? 'Collapse sidebar' : 'Expand sidebar'}
          >
            {sidebarVisible ? <PanelLeftClose className="h-5 w-5" strokeWidth={2} /> : <PanelLeftOpen className="h-5 w-5" strokeWidth={2} />}
          </button>

          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-fg">{title}</div>
            <div className="min-w-0">
              <Breadcrumbs items={crumbs} />
            </div>
          </div>

          {(portalModule === null || portalModule === 'food') && (
            <button
              type="button"
              onClick={() => {
                setRepPhoneInput(repPhone)
                setRepPhoneModalOpen(true)
              }}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-xs text-muted transition-colors duration-200 hover:bg-subtle hover:text-fg disabled:opacity-50"
              disabled={repPhoneLoading}
              title="Set your phone number"
            >
              <span>Phone:</span>
              <span className="font-medium text-fg">{repPhone ? repPhone : 'Not set'}</span>
              <span className="text-subtext">Edit</span>
            </button>
          )}

          <div className="flex shrink-0 items-center gap-1.5">
            <ThemeToggle />
            <button
              type="button"
              onClick={doLogout}
              className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger-bg hover:text-danger sm:inline-flex"
            >
              <LogOut className="h-4 w-4" strokeWidth={2} />
              Logout
            </button>
            <button
              type="button"
              onClick={doLogout}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-colors duration-200 hover:bg-danger-bg hover:text-danger sm:hidden"
              aria-label="Logout"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* Page */}
        <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <DraggableModal open={repPhoneModalOpen} onClose={() => setRepPhoneModalOpen(false)} title="Update Phone Number">
        <div className="space-y-3">
          <input
            value={repPhoneInput}
            onChange={(e) => setRepPhoneInput(e.target.value)}
            placeholder="e.g. 0803 123 4567"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-fg placeholder:text-subtext focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
            disabled={repPhoneSaving}
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={saveRepPhone}
              disabled={repPhoneSaving}
              className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-on-accent transition-colors duration-200 ease-sakani hover:bg-brand-hover disabled:opacity-50"
            >
              {repPhoneSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setRepPhoneModalOpen(false)}
              disabled={repPhoneSaving}
              className="rounded-lg border border-line bg-surface px-4 py-2 text-sm font-medium text-fg transition-colors duration-200 ease-sakani hover:bg-subtle disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </DraggableModal>
    </div>
  )
}
