'use client'

// app/admin/layout.jsx
// Sakani admin shell — sidebar (icons + active accent pill, collapsible rail) + topbar.
import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { useAuth } from '../contexts/AuthContext'
import ThemeToggle from '../components/ui/ThemeToggle'
import Breadcrumbs from '../components/ui/Breadcrumbs'
import BreadcrumbHint from '../components/ui/BreadcrumbHint'
import { getTrail } from '@/lib/breadcrumbs'
import useFocusTrap, { useIsMobileView } from '../hooks/useFocusTrap'
import {
  ArrowLeft,
  BarChart3,
  Boxes,
  CheckCircle2,
  ChevronDown,
  Clock,
  Database,
  History,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  Send,
  Store,
  Truck,
  Users,
  X,
  XCircle,
} from 'lucide-react'

export const dynamic = 'force-dynamic'

/* ─── Nav building blocks ─────────────────────────────────────── */

function NavLink({ href, label, icon: Icon, active, collapsed, onNavigate }) {
  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
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
    </Link>
  )
}

function GroupToggle({ open, onToggle, label, collapsed, onNavigate, status, statusTone = 'muted' }) {
  // A muted status (e.g. "Closed") dims the group so staff can see the module
  // is not live at a glance; the group stays clickable (they may need to open
  // Cycles to activate it). A success status shows a green "Active" pill.
  const dimmed = status != null && statusTone !== 'success'
  return (
    <button
      type="button"
      onClick={collapsed ? onNavigate : onToggle}
      title={collapsed ? (status ? `${label} · ${status}` : label) : undefined}
      className={[
        'flex w-full items-center rounded-lg py-2 text-chips font-semibold uppercase tracking-wider',
        'transition-colors duration-200 ease-sakani',
        collapsed ? 'justify-center px-0' : 'justify-between px-3',
        open
          ? 'bg-subtle text-fg'
          : dimmed
            ? 'text-muted hover:bg-subtle hover:text-fg'
            : 'text-subtext hover:bg-subtle hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      ].join(' ')}
    >
      {collapsed ? (
        <span className="flex h-4 w-4 items-center justify-center rounded-md bg-subtle">
          <span
            className={['h-1.5 w-1.5 rounded-full', statusTone === 'success' ? 'bg-success' : 'bg-subtext'].join(' ')}
            aria-hidden="true"
          />
        </span>
      ) : (
        <>
          <span className="truncate">{label}</span>
          <span className="flex shrink-0 items-center gap-1.5">
            {status && (
              <span
                className={[
                  'rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                  statusTone === 'success' ? 'bg-success-bg text-success-fg' : 'bg-line/70 text-muted',
                ].join(' ')}
              >
                {status}
              </span>
            )}
            <ChevronDown className={['h-3.5 w-3.5 transition-transform duration-200 ease-sakani', open ? 'rotate-180' : ''].join(' ')} />
          </span>
        </>
      )}
    </button>
  )
}

function SubGroupToggle({ open, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={[
        'flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-xs font-semibold',
        'transition-colors duration-200 ease-sakani',
        open ? 'text-fg' : 'text-muted hover:bg-subtle hover:text-fg',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40',
      ].join(' ')}
    >
      <span>{label}</span>
      <ChevronDown className={['h-3.5 w-3.5 transition-transform duration-200 ease-sakani', open ? 'rotate-180' : ''].join(' ')} />
    </button>
  )
}

function Divider() {
  return <div className="my-2 h-px bg-line-subtle" aria-hidden="true" />
}

/* ─── Layout ──────────────────────────────────────────────────── */

export default function AdminLayout({ children }) {
  const pathname = usePathname()
  const { logout } = useAuth()
  const isPinPage = pathname.startsWith('/admin/pin')

  const [sidebarVisible, setSidebarVisible] = useState(true)
  const [mobileOpen, setMobileOpen] = useState(false)
  // Accordion module groups — all collapsed on entry; only one open at a time,
  // and only when clicked (the active page never auto-expands its section).
  // The last-opened group persists in localStorage so a reload restores it.
  const [openModule, setOpenModule] = useState(null) // 'food' | 'ram' | 'exhibition' | null
  const foodOpen = openModule === 'food'
  const ramOpen = openModule === 'ram'
  const exhOpen = openModule === 'exhibition'
  const toggleModule = (key) => setOpenModule((cur) => (cur === key ? null : key))
  // Sub-group accordion per module — 'orders' or 'ops' open at a time; expanding
  // one collapses the other within the same module (clicking the open one closes both).
  const [foodSub, setFoodSub] = useState('orders')
  const foodOrdersOpen = foodSub === 'orders'
  const foodOpsOpen = foodSub === 'ops'
  const toggleFoodSub = (key) => setFoodSub((cur) => (cur === key ? null : key))
  const [ramSub, setRamSub] = useState('orders')
  const ramOrdersOpen = ramSub === 'orders'
  const ramOpsOpen = ramSub === 'ops'
  const toggleRamSub = (key) => setRamSub((cur) => (cur === key ? null : key))
  const [exhSub, setExhSub] = useState('orders')
  const exhOrdersOpen = exhSub === 'orders'
  const exhOpsOpen = exhSub === 'ops'
  const toggleExhSub = (key) => setExhSub((cur) => (cur === key ? null : key))
  // Whether each module is live — drives the sidebar group's Active/Closed
  // chips so staff see live status without opening the dashboard, no matter
  // which admin page they're browsing. null = still loading (no badge yet,
  // avoids a false "Closed"). Food and Ram read the same public shopping
  // flags the portal uses; exhibition derives from active cycles.
  const [foodLive, setFoodLive] = useState(null)
  const [ramLive, setRamLive] = useState(null)
  const [exhLive, setExhLive] = useState(null)

  // Hydrate the sidebar preferences after mount (not in the useState
  // initializer) so the server and the first client render agree — reading
  // localStorage during render caused a hydration mismatch on every admin
  // page when a persisted value differed from the server default. This runs
  // before the persist effects below, so the stored values are restored.
  useEffect(() => {
    try {
      const vis = window.localStorage.getItem('admin_sidebar_visible')
      if (vis !== null) setSidebarVisible(vis === '1')
      const mod = window.localStorage.getItem('admin_sidebar_open_module')
      if (mod === 'food' || mod === 'ram' || mod === 'exhibition') setOpenModule(mod)
      // Restore the sub-group (Orders/Operations) so a reload lands the user
      // in the exact section they were working in, not back at the Orders
      // default — this was why clicking a page seemed to "close" Operations
      // and reopen Orders after a remount.
      const sub = window.localStorage.getItem('admin_sidebar_subgroup')
      if (sub === 'food:orders' || sub === 'food:ops') setFoodSub(sub === 'food:ops' ? 'ops' : 'orders')
      if (sub === 'ram:orders' || sub === 'ram:ops') setRamSub(sub === 'ram:ops' ? 'ops' : 'orders')
      if (sub === 'exh:orders' || sub === 'exh:ops') setExhSub(sub === 'exh:ops' ? 'ops' : 'orders')
    } catch {}
  }, [])

  // Persist the sub-group per module so a reload restores the exact section.
  useEffect(() => {
    try {
      const key = openModule
        ? `${openModule}:${openModule === 'food' ? foodSub : openModule === 'ram' ? ramSub : exhSub}`
        : null
      if (key) window.localStorage.setItem('admin_sidebar_subgroup', key)
      else window.localStorage.removeItem('admin_sidebar_subgroup')
    } catch {}
  }, [openModule, foodSub, ramSub, exhSub])

  useEffect(() => {
    let cancelled = false
    Promise.allSettled([
      fetch('/api/system/shopping', { cache: 'no-store' }),
      fetch('/api/system/ram-shopping', { cache: 'no-store' }),
      fetch('/api/system/exhibition-shopping', { cache: 'no-store' }),
    ]).then(async (results) => {
      if (cancelled) return
      const [foodRes, ramRes, exhRes] = results
      const read = async (r) => {
        try {
          const j = await r.value.json()
          return j?.ok ? !!j.open : null
        } catch {
          return null
        }
      }
      const [food, ram, exh] = await Promise.all([
        foodRes.status === 'fulfilled' ? read(foodRes) : null,
        ramRes.status === 'fulfilled' ? read(ramRes) : null,
        exhRes.status === 'fulfilled' ? read(exhRes) : null,
      ])
      if (cancelled) return
      setFoodLive(food)
      setRamLive(ram)
      setExhLive(exh)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const hamburgerRef = useRef(null)
  const sidebarRef = useRef(null)

  const isCollapsed = !sidebarVisible && !mobileOpen

  useEffect(() => {
    try {
      window.localStorage.setItem('admin_sidebar_visible', sidebarVisible ? '1' : '0')
    } catch {}
  }, [sidebarVisible])

  // Persist the open module group so a reload restores the last section worked in.
  useEffect(() => {
    try {
      if (openModule) window.localStorage.setItem('admin_sidebar_open_module', openModule)
      else window.localStorage.removeItem('admin_sidebar_open_module')
    } catch {}
  }, [openModule])

  const activeKey = useMemo(() => {
    if (pathname === '/admin') return 'dashboard'
    if (pathname.startsWith('/admin/members')) return 'members'
    if (pathname.startsWith('/admin/food/pending')) return 'food_pending'
    if (pathname.startsWith('/admin/food/cancelled')) return 'food_cancelled'
    if (pathname.startsWith('/admin/food/posted')) return 'food_posted'
    if (pathname.startsWith('/admin/food/delivered')) return 'food_delivered'
    if (pathname.startsWith('/admin/food/banks')) return 'food_banks'
    if (pathname.startsWith('/admin/food/inventory')) return 'food_inventory'
    if (pathname.startsWith('/admin/food/markups')) return 'food_markups'
    if (pathname.startsWith('/admin/food/reports')) return 'food_reports'
    if (pathname.startsWith('/admin/food/audit')) return 'food_audit'
    if (pathname.startsWith('/admin/food/data-management')) return 'food_data'
    if (pathname.startsWith('/admin/food/cart')) return 'food_cart'
    if (pathname.startsWith('/admin/ram/pending')) return 'ram_pending'
    if (pathname.startsWith('/admin/ram/cancelled')) return 'ram_cancelled'
    if (pathname.startsWith('/admin/ram/approved')) return 'ram_approved'
    if (pathname.startsWith('/admin/ram/delivered')) return 'ram_delivered'
    if (pathname.startsWith('/admin/ram/banks')) return 'ram_banks'
    if (pathname.startsWith('/admin/ram/reports')) return 'ram_reports'
    if (pathname.startsWith('/admin/ram/audit')) return 'ram_audit'
    if (pathname.startsWith('/admin/ram/data')) return 'ram_data'
    if (pathname.startsWith('/admin/exhibition/pending')) return 'exh_pending'
    if (pathname.startsWith('/admin/exhibition/approved')) return 'exh_approved'
    if (pathname.startsWith('/admin/exhibition/delivered')) return 'exh_delivered'
    if (pathname.startsWith('/admin/exhibition/cancelled')) return 'exh_cancelled'
    if (pathname.startsWith('/admin/exhibition/cycles')) return 'exh_cycles'
    if (pathname.startsWith('/admin/exhibition/vendors')) return 'exh_vendors'
    if (pathname.startsWith('/admin/exhibition/products')) return 'exh_products'
    if (pathname.startsWith('/admin/exhibition/markups')) return 'exh_markups'
    if (pathname.startsWith('/admin/exhibition/payouts')) return 'exh_payouts'
    if (pathname.startsWith('/admin/exhibition/banks')) return 'exh_banks'
    if (pathname.startsWith('/admin/exhibition/data')) return 'exh_data'
    if (pathname.startsWith('/admin/exhibition/audit')) return 'exh_audit'
    return ''
  }, [pathname])

  // Trail + header title come from the shared breadcrumb table (staff lookups
  // always resolve — unknown keys fall back to the portal root inside the helper).
  const { title, crumbs } = useMemo(() => getTrail('admin', activeKey), [activeKey])

  const doLogout = async () => {
    try {
      await fetch('/api/admin/pin/session', { method: 'DELETE', credentials: 'include' }).catch(() => null)
    } catch {}
    logout()
  }

  const closeMobile = () => setMobileOpen(false)

  // Focus management for the mobile drawer — Tab trap, focus in/restore, ESC,
  // and release when the viewport crosses the desktop breakpoint.
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

  if (isPinPage) return children

  const navOnClick = () => {
    if (window.innerWidth < 1024) setMobileOpen(false)
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      {/* First-run hint pointing at the clickable breadcrumb trail */}
      <BreadcrumbHint portal="admin" />

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
            C
          </span>
          {!isCollapsed && (
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-fg">CBN Coop</div>
              <div className="truncate text-xs text-muted">Admin Console</div>
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
          <NavLink
            href="/admin"
            label="Dashboard"
            icon={LayoutDashboard}
            active={activeKey === 'dashboard'}
            collapsed={isCollapsed}
            onNavigate={navOnClick}
          />

          <div className="pt-2">
            <GroupToggle
              open={foodOpen}
              onToggle={() => toggleModule('food')}
              label="Food Distribution"
              collapsed={isCollapsed}
              onNavigate={() => setSidebarVisible(true)}
              status={foodLive == null ? undefined : foodLive ? 'Active' : 'Closed'}
              statusTone={foodLive ? 'success' : 'muted'}
            />
            {!isCollapsed && foodOpen && (
              <div className="mt-1 space-y-0.5">
                <SubGroupToggle open={foodOrdersOpen} onToggle={() => toggleFoodSub('orders')} label="Food Orders" />
                {foodOrdersOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/food/pending" label="Pending" icon={Clock} active={activeKey === 'food_pending'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/posted" label="Posted" icon={Send} active={activeKey === 'food_posted'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/delivered" label="Delivered" icon={Truck} active={activeKey === 'food_delivered'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/cancelled" label="Cancelled" icon={XCircle} active={activeKey === 'food_cancelled'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
                <SubGroupToggle open={foodOpsOpen} onToggle={() => toggleFoodSub('ops')} label="Food Operations" />
                {foodOpsOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/food/banks" label="Banks" icon={Landmark} active={activeKey === 'food_banks'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/inventory" label="Inventory" icon={Boxes} active={activeKey === 'food_inventory'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/markups" label="Markups" icon={Percent} active={activeKey === 'food_markups'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/reports" label="Report" icon={BarChart3} active={activeKey === 'food_reports'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/audit" label="Audit Log" icon={History} active={activeKey === 'food_audit'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/food/data-management" label="Data" icon={Database} active={activeKey === 'food_data'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-2">
            <GroupToggle
              open={ramOpen}
              onToggle={() => toggleModule('ram')}
              label="Ram Sales"
              collapsed={isCollapsed}
              onNavigate={() => setSidebarVisible(true)}
              status={ramLive == null ? undefined : ramLive ? 'Active' : 'Closed'}
              statusTone={ramLive ? 'success' : 'muted'}
            />
            {!isCollapsed && ramOpen && (
              <div className="mt-1 space-y-0.5">
                <SubGroupToggle open={ramOrdersOpen} onToggle={() => toggleRamSub('orders')} label="Ram Orders" />
                {ramOrdersOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/ram/pending" label="Pending" icon={Clock} active={activeKey === 'ram_pending'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/approved" label="Approved" icon={CheckCircle2} active={activeKey === 'ram_approved'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/delivered" label="Delivered" icon={Truck} active={activeKey === 'ram_delivered'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/cancelled" label="Cancelled" icon={XCircle} active={activeKey === 'ram_cancelled'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
                <SubGroupToggle open={ramOpsOpen} onToggle={() => toggleRamSub('ops')} label="Ram Operations" />
                {ramOpsOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/ram/banks" label="Banks" icon={Landmark} active={activeKey === 'ram_banks'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/reports" label="Report" icon={BarChart3} active={activeKey === 'ram_reports'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/audit" label="Audit Log" icon={History} active={activeKey === 'ram_audit'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/ram/data" label="Data" icon={Database} active={activeKey === 'ram_data'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-2">
            <GroupToggle
              open={exhOpen}
              onToggle={() => toggleModule('exhibition')}
              label="Coop Exhibition"
              collapsed={isCollapsed}
              onNavigate={() => setSidebarVisible(true)}
              status={exhLive == null ? undefined : exhLive ? 'Active' : 'Closed'}
              statusTone={exhLive ? 'success' : 'muted'}
            />
            {!isCollapsed && exhOpen && (
              <div className="mt-1 space-y-0.5">
                <SubGroupToggle open={exhOrdersOpen} onToggle={() => toggleExhSub('orders')} label="Exhibition Orders" />
                {exhOrdersOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/exhibition/pending" label="Pending" icon={Clock} active={activeKey === 'exh_pending'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/approved" label="Approved" icon={CheckCircle2} active={activeKey === 'exh_approved'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/delivered" label="Delivered" icon={Truck} active={activeKey === 'exh_delivered'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/cancelled" label="Cancelled" icon={XCircle} active={activeKey === 'exh_cancelled'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
                <SubGroupToggle open={exhOpsOpen} onToggle={() => toggleExhSub('ops')} label="Exhibition Operations" />
                {exhOpsOpen && (
                  <div className="mt-0.5 space-y-0.5">
                    <NavLink href="/admin/exhibition/vendors" label="Vendors" icon={Store} active={activeKey === 'exh_vendors'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/products" label="Products" icon={Package} active={activeKey === 'exh_products'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/markups" label="Markups" icon={Percent} active={activeKey === 'exh_markups'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/banks" label="Banks" icon={Landmark} active={activeKey === 'exh_banks'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/data" label="Data" icon={Database} active={activeKey === 'exh_data'} collapsed={false} onNavigate={navOnClick} />
                    <NavLink href="/admin/exhibition/audit" label="Audit Log" icon={History} active={activeKey === 'exh_audit'} collapsed={false} onNavigate={navOnClick} />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="pt-2">
            <NavLink href="/admin/members" label="Members Settings" icon={Users} active={activeKey === 'members'} collapsed={isCollapsed} onNavigate={navOnClick} />
          </div>
        </nav>

        {/* Footer */}
        <div className="shrink-0 space-y-0.5 border-t border-line px-3 py-3">
          {isCollapsed ? (
            <div className="space-y-0.5">
              <NavLink href="/portal" label="Portal" icon={ArrowLeft} active={false} collapsed onNavigate={navOnClick} />
              <button
                type="button"
                onClick={doLogout}
                title="Logout"
                className="flex w-full items-center justify-center rounded-lg py-2 text-muted transition-colors duration-200 hover:bg-danger-bg hover:text-danger"
                aria-label="Logout"
              >
                <LogOut className="h-4 w-4" strokeWidth={2} />
              </button>
            </div>
          ) : (
            <>
              <NavLink href="/portal" label="Back to Portal" icon={ArrowLeft} active={false} collapsed={false} onNavigate={navOnClick} />
              <button
                type="button"
                onClick={doLogout}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted transition-colors duration-200 hover:bg-danger-bg hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} />
                <span>Logout</span>
              </button>
            </>
          )}
        </div>
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
    </div>
  )
}
