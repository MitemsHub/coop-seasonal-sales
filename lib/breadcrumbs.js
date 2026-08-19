// lib/breadcrumbs.js
// Single source of truth for every breadcrumb trail in the app.
//
//   getTrail(portal, key) →
//     'member': key is the pathname (e.g. '/ram/shop') → crumbs[] | null
//     'admin' | 'rep': key is the sidebar activeKey (e.g. 'food_pending') →
//                      { title, crumbs } (never null — falls back to the portal root)
//
// Add a new route in ONE place below and the member Navbar, admin layout, and
// rep layout all pick it up automatically.

const crumb = (label, href) => (href ? { label, href } : { label })

// ── Shared vocabulary ────────────────────────────────────────────────

// Module groups shown as the middle crumb on staff portals.
const MODULES = {
  food: { label: 'Food Distribution' },
  ram: { label: 'Ram Sales' },
  exhibition: { label: 'Coop Exhibition' },
}

// Page key → label, shared by the admin and rep portals.
const PAGE_LABELS = {
  pending: 'Pending',
  posted: 'Posted',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
  approved: 'Approved',
  banks: 'Banks',
  import: 'Import',
  inventory: 'Inventory',
  markups: 'Markups',
  reports: 'Report',
  data: 'Data',
  cart: 'Member Cart',
  cycles: 'Cycles',
  vendors: 'Vendors',
  products: 'Products',
  payouts: 'Payouts',
  audit: 'Audit Log',
}

// Portal roots + the hub href each module links back to.
const PORTALS = {
  admin: {
    root: crumb('Admin', '/admin'),
    hub: { food: '/admin?module=food', ram: '/admin?module=ram', exhibition: '/admin?module=exhibition' },
    dashboardTitle: 'Dashboard',
  },
  rep: {
    root: crumb('Rep Portal', '/portal'),
    hub: { food: '/rep/pending', ram: '/rep/ram/approved', exhibition: '/rep/exhibition/pending' },
    fallbackTitle: 'Rep',
  },
}

// ── Member routes (key = pathname) ───────────────────────────────────
// Ordered — exact matches first, then prefix matches.
const MEMBER_ROUTES = [
  { test: (p) => p === '/my-coop', trail: () => [crumb('My Coop', '/my-coop')] },
  {
    test: (p) => p === '/shop',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Shop', '/shop')],
  },
  {
    test: (p) => p === '/cart',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Shop', '/shop'), crumb('Checkout', '/cart')],
  },
  {
    test: (p) => p === '/orders',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Orders', '/orders')],
  },
  {
    test: (p) => p.startsWith('/shop/success'),
    trail: (p) => [crumb('My Coop', '/my-coop'), crumb('Shop', '/shop'), crumb('Order Confirmed', p)],
  },
  {
    test: (p) => p === '/ram',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Ram Sales', '/ram')],
  },
  {
    test: (p) => p.startsWith('/ram/shop'),
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Ram Sales', '/ram'), crumb('Shop', '/ram/shop')],
  },
  {
    test: (p) => p.startsWith('/ram/success'),
    trail: (p) => [crumb('My Coop', '/my-coop'), crumb('Ram Sales', '/ram'), crumb('Ram Order Submitted', p)],
  },
  {
    test: (p) => p === '/exhibition',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition')],
  },
  {
    test: (p) => p === '/exhibition/orders',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition'), crumb('My Orders', '/exhibition/orders')],
  },
  {
    test: (p) => p === '/exhibition/all',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition'), crumb('All Products', '/exhibition/all')],
  },
  {
    test: (p) => p.startsWith('/exhibition/vendor/'),
    trail: (p) => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition'), crumb('Vendor Hub', p)],
  },
  {
    test: (p) => p === '/exhibition/cart',
    trail: () => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition'), crumb('Checkout', '/exhibition/cart')],
  },
  {
    test: (p) => p.startsWith('/exhibition/success'),
    trail: (p) => [crumb('My Coop', '/my-coop'), crumb('Exhibition', '/exhibition'), crumb('Order Confirmed', p)],
  },
]

// ── Vendor routes (key = pathname) ───────────────────────────────────
const VENDOR_ROUTES = [
  {
    test: (p) => p === '/vendor' || p === '/vendor/dashboard',
    trail: () => [crumb('Vendor Portal', '/vendor'), crumb('Dashboard')],
  },
  {
    test: (p) => p === '/vendor/products',
    trail: () => [crumb('Vendor Portal', '/vendor/dashboard'), crumb('Products')],
  },
  {
    test: (p) => p === '/vendor/markups',
    trail: () => [crumb('Vendor Portal', '/vendor/dashboard'), crumb('Prices & Markups')],
  },
  {
    test: (p) => p === '/vendor/orders',
    trail: () => [crumb('Vendor Portal', '/vendor/dashboard'), crumb('Orders')],
  },
  {
    test: (p) => p === '/vendor/deliveries',
    trail: () => [crumb('Vendor Portal', '/vendor/dashboard'), crumb('Deliveries')],
  },
]

function getVendorTrail(pathname) {
  for (const route of VENDOR_ROUTES) {
    if (route.test(pathname)) return route.trail(pathname)
  }
  return null
}

// ── Staff pages (key = activeKey like 'food_pending') ────────────────
const STAFF_PAGES = {
  admin: {
    food: ['pending', 'cancelled', 'posted', 'delivered', 'banks', 'inventory', 'markups', 'reports', 'audit', 'data', 'cart'],
    ram: ['pending', 'cancelled', 'approved', 'delivered', 'banks', 'reports', 'audit', 'data'],
    exhibition: ['pending', 'approved', 'delivered', 'cancelled', 'cycles', 'vendors', 'products', 'markups', 'banks', 'data', 'audit'],
  },
  rep: {
    food: ['posted', 'delivered', 'banks'],
    ram: ['approved', 'delivered', 'banks'],
    exhibition: ['pending', 'approved', 'delivered', 'cancelled', 'banks'],
  },
}

// ── Lookup ───────────────────────────────────────────────────────────

function getMemberTrail(pathname) {
  for (const route of MEMBER_ROUTES) {
    if (route.test(pathname)) return route.trail(pathname)
  }
  return null
}

function getStaffTrail(portal, activeKey) {
  const cfg = PORTALS[portal]

  if (portal === 'admin' && activeKey === 'dashboard') {
    return { title: cfg.dashboardTitle, crumbs: [cfg.root, crumb(cfg.dashboardTitle)] }
  }

  // Members Settings — a cross-module admin area, not tied to one module group.
  if (portal === 'admin' && activeKey === 'members') {
    return { title: 'Members Settings', crumbs: [cfg.root, crumb('Members Settings')] }
  }
  if (portal === 'admin' && activeKey === 'members_auth') {
    return { title: 'Auth Onboarding', crumbs: [cfg.root, crumb('Members Settings', '/admin/members'), crumb('Auth Onboarding')] }
  }

  // Reps land on their dashboard at /rep — same trail pattern as the admin.
  if (portal === 'rep' && activeKey === 'dashboard') {
    return { title: 'Dashboard', crumbs: [cfg.root, crumb('Dashboard')] }
  }

  const [rawMod, ...restParts] = String(activeKey || '').split('_')
  // The admin layout keys the exhibition group 'exh_*' for brevity — normalize
  // it back to the module key used by STAFF_PAGES/MODULES.
  const mod = rawMod === 'exh' ? 'exhibition' : rawMod
  const page = restParts.join('_')
  const knownPages = STAFF_PAGES[portal][mod]
  if (!mod || !page || !knownPages || !knownPages.includes(page)) {
    return { title: portal === 'rep' ? cfg.fallbackTitle : cfg.root.label, crumbs: [cfg.root] }
  }

  const modLabel = MODULES[mod].label
  const pageLabel = PAGE_LABELS[page] || page
  return {
    title: `${modLabel} — ${pageLabel}`,
    crumbs: [cfg.root, crumb(modLabel, cfg.hub[mod]), crumb(pageLabel)],
  }
}

export function getTrail(portal, key) {
  if (portal === 'member') return getMemberTrail(key)
  if (portal === 'admin') return getStaffTrail('admin', key)
  if (portal === 'rep') return getStaffTrail('rep', key)
  if (portal === 'vendor') return getVendorTrail(key)
  return null
}
