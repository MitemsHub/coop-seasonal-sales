'use client'

// app/portal/page.jsx — the members portal.
// Shares the landing page's header, CTA language and card styling so the
// guest journey (landing → portal → shop) feels like one product.

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRight, MapPin, ShieldCheck, ShoppingBasket, Store, Truck } from 'lucide-react'
import LandingHeader, { SIGNUP_URL } from '../components/LandingHeader'
import MemberAuth from '../components/MemberAuth'
import Reveal from '../components/ui/Reveal'

const PORTAL_NAV = [
  { href: '#member', label: 'Member sign in' },
  { href: '#teams', label: 'Team portals' },
]

const STAT_CHIPS = [
  { icon: MapPin, label: '37 branches' },
  { icon: ShoppingBasket, label: 'Seasonal sales' },
]

// Rotating module chip — same treatment as the landing page hero word, so the
// portal chip cycles the seasonal modules instead of a static "Ram season".
const SEASON_WORDS = ['Food season', 'Ram season', 'Coop Exhibition']

function RotatingSeasonChip() {
  const reduce = useReducedMotion()
  const [i, setI] = useState(0)
  const ROTATE_MS = 2800

  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setI((v) => (v + 1) % SEASON_WORDS.length), ROTATE_MS)
    return () => clearInterval(id)
  }, [reduce, ROTATE_MS])

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-fluid-xs py-fluid-2xs text-chips font-medium text-white sm:text-xs">
      <ShoppingBasket className="h-3 w-3 text-brand-200" strokeWidth={2} />
      <span className="relative inline-flex">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={SEASON_WORDS[i]}
            initial={{ opacity: 0, y: 8, filter: 'blur(3px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(3px)' }}
            transition={{ duration: 0.3, ease: [0.33, 1, 0.68, 1] }}
          >
            {SEASON_WORDS[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </span>
  )
}


export default function PortalPage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <LandingHeader
        navLinks={PORTAL_NAV}
        navLabel="Portal"
        cta={{ label: 'Become a Member', href: SIGNUP_URL, external: true }}
        drawerSecondary={{ label: 'Member Login', href: '#member' }}
      />

      {/* =================== HERO — brand gradient + member sign in =================== */}
      <section id="member" className="relative scroll-mt-20 overflow-hidden">
        {/* Ambient background tints */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute -top-24 right-[-8%] h-80 w-80 rounded-full bg-brand-500/10 blur-3xl" />
          <div className="absolute bottom-[-30%] left-[-6%] h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:py-14 lg:px-6 lg:py-16">
          <Reveal>
            <div className="relative overflow-hidden rounded-2xl border border-brand-800 bg-gradient-to-br from-brand-900 via-brand-800 to-brand-700 shadow-xl">
              <div
                className="pointer-events-none absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    'radial-gradient(circle at 15% 15%, rgba(255,255,255,0.35), transparent 40%), radial-gradient(circle at 85% 90%, rgba(255,255,255,0.22), transparent 40%)',
                }}
                aria-hidden
              />
              <div className="relative grid gap-10 p-6 sm:p-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:gap-14 lg:p-12">
                {/* Copy */}
                <div>
                  <span className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-fluid-xs py-fluid-2xs text-chips font-semibold text-white shadow-xs sm:text-xs">
                    <span className="relative flex h-2 w-2">
                      <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-brand-200 opacity-60" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-brand-200" />
                    </span>
                    Members portal
                  </span>

                  {/* Hero headline — deliberately off the fluid text scale (like the
                      design-system showcase): a marketing hero on a dark card, sized by
                      breakpoint chain 26 → 36 → 44px rather than the text-h1 utility. */}
                  <h1 className="mt-5 text-[1.4375rem] font-bold leading-[1.15] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
                    Welcome to{' '}
                    <span className="whitespace-nowrap text-brand-200">Coop Seasonal Sales</span>
                  </h1>

                  <p className="mt-4 max-w-md text-sm leading-6 text-white/85 sm:text-base">
                    Sign in to order this cycle&apos;s seasonal sales, then pick up at your branch.
                  </p>

                  {/* Stat chips + rotating module chip */}
                  <div className="mt-6 flex flex-wrap gap-2">
                    {STAT_CHIPS.map((c) => (
                      <span
                        key={c.label}
                        className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-fluid-xs py-fluid-2xs text-chips font-medium text-white sm:text-xs"
                      >
                        <c.icon className="h-3 w-3 text-brand-200" strokeWidth={2} />
                        {c.label}
                      </span>
                    ))}
                    <RotatingSeasonChip />
                  </div>

                </div>

                {/* Member launcher — kept intact, wrapped in a surface card */}
                <div className="rounded-2xl border border-white/15 bg-surface p-5 shadow-2xl sm:p-6">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-subtle text-brand">
                      <ShoppingBasket className="h-5 w-5" strokeWidth={2} />
                    </span>
                    <div className="leading-tight">
                      <h2 className="text-sm font-bold text-fg">Member sign in</h2>
                      <p className="text-xs text-muted">Enter your staff ID to continue</p>
                    </div>
                  </div>
                  <MemberAuth />
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============================ TEAM PORTALS ============================ */}
      <section id="teams" className="scroll-mt-20 border-t border-line bg-subtle/40">
        <div className="mx-auto max-w-7xl px-4 py-12 lg:px-6 lg:py-16">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              Team portals
            </span>
            <h2 className="mt-4 text-h2 font-bold tracking-tight text-fg">
              For branch reps, vendors &amp; system administrators
            </h2>
            <p className="mt-3 text-sm leading-6 text-fg/80">
              The people who run deliveries, stock the market and keep the Coop running, in
              three dedicated workspaces.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* Reps */}
            <Reveal>
              <div className="group h-full rounded-xl border border-line bg-surface p-6 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg transition-transform duration-200 group-hover:scale-105">
                  <Truck className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-[13px] font-semibold text-fg sm:text-base">Reps Portal</h3>
                <p className="mt-1.5 text-sm leading-5 text-fg/80">
                  Manage pending and delivered orders for your delivery branch. Processing and
                  delivery coordination in one place.
                </p>
                <Link
                  href="/rep/access"
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>

            {/* Vendor */}
            <Reveal delay={0.08}>
              <div className="group h-full rounded-xl border border-line bg-surface p-6 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg transition-transform duration-200 group-hover:scale-105">
                  <Store className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-[13px] font-semibold text-fg sm:text-base">Vendor Portal</h3>
                <p className="mt-1.5 text-sm leading-5 text-fg/80">
                  Manage your exhibition stand: upload products, set prices and mark orders
                  delivered when you hand the goods over.
                </p>
                <Link
                  href="/vendor"
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>

            {/* Admin */}
            <Reveal delay={0.16}>
              <div className="group h-full rounded-xl border border-line bg-surface p-6 shadow-xs transition-[border-color,box-shadow] duration-200 hover:border-line-strong hover:shadow-md">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-subtle text-brand-fg transition-transform duration-200 group-hover:scale-105">
                  <ShieldCheck className="h-5.5 w-5.5" strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-[13px] font-semibold text-fg sm:text-base">Admin Portal</h3>
                <p className="mt-1.5 text-sm leading-5 text-fg/80">
                  Complete system control: inventory, order approvals, reporting, markups and data
                  imports.
                </p>
                <Link
                  href="/admin/pin"
                  className="mt-5 inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-brand px-5 text-sm font-medium text-on-accent shadow-xs transition-colors duration-200 hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  Sign in
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ============================== FOOTER ============================== */}
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-center sm:flex-row sm:text-left lg:px-6">
          <p className="text-xs text-muted">© 2026 CBN Coop Seasonal Sales. All rights reserved.</p>
          <p className="text-xs text-muted">
            Need help?{' '}
            <span className="font-medium text-fg">
              customerservice@cbncoopng.com, 09096797982, 08180578550
            </span>
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted">
            Powered by
            <Link
              href="/contact"
              className="rounded font-semibold text-brand transition-colors duration-150 hover:text-brand-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              MitemsHub
            </Link>
          </p>
        </div>
      </footer>
    </div>
  )
}
