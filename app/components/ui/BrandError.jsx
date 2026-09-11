// app/components/ui/BrandError.jsx
// Branded error boundary shown when a page crashes. Features the Coop logo,
// contextual messaging, and quick-nav links back to safe pages.
'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'

const NAV_LINKS = {
  root: [
    { href: '/', label: 'Home' },
    { href: '/portal', label: 'Member Portal' },
    { href: '/shop', label: 'Shop' },
    { href: '/exhibition', label: 'Exhibition' },
  ],
  admin: [
    { href: '/admin', label: 'Admin Dashboard' },
    { href: '/admin/exhibition/cycles', label: 'Exhibition Cycles' },
    { href: '/admin/exhibition/vendors', label: 'Vendors' },
  ],
  portal: [
    { href: '/portal', label: 'Member Portal' },
    { href: '/shop', label: 'Shop' },
    { href: '/exhibition', label: 'Exhibition' },
    { href: '/', label: 'Home' },
  ],
  vendor: [
    { href: '/vendor/dashboard', label: 'Vendor Dashboard' },
    { href: '/vendor/products', label: 'Products' },
    { href: '/vendor/orders', label: 'Orders' },
  ],
  rep: [
    { href: '/rep/exhibition/pending', label: 'Rep Dashboard' },
    { href: '/rep/exhibition/approved', label: 'Approved Orders' },
  ],
  shop: [
    { href: '/shop', label: 'Shop' },
    { href: '/exhibition', label: 'Exhibition' },
    { href: '/portal', label: 'Member Portal' },
  ],
}

export default function BrandError({
  error,
  reset,
  context = 'root',       // 'root' | 'admin' | 'portal' | 'vendor' | 'rep' | 'shop'
  title,                   // override the default title
  message,                 // override the default message
  showDetails = true,
  fullScreen = false,
}) {
  useEffect(() => {
    if (error) console.error(`[${context} error]:`, error)
  }, [error, context])

  const headings = {
    root: 'Something went wrong',
    admin: 'Admin panel error',
    portal: 'Portal error',
    vendor: 'Vendor portal error',
    rep: 'Rep panel error',
    shop: 'Shop error',
  }

  const descriptions = {
    root: 'An unexpected error occurred while loading this page. Our team has been notified. Please try again or head back to a safe page.',
    admin: 'This admin page encountered an error. You can try reloading or return to the admin dashboard.',
    portal: 'We hit an unexpected error while loading this page. Please try again or return to the portal.',
    vendor: 'The vendor portal ran into an issue. You can try again or go back to your dashboard.',
    rep: 'This rep page encountered an error. Try again or return to the rep dashboard.',
    shop: 'The shop ran into an issue while loading. Please try again or browse from the homepage.',
  }

  const links = NAV_LINKS[context] || NAV_LINKS.root

  return (
    <div className={`relative overflow-hidden ${fullScreen ? 'min-h-screen' : 'min-h-[60vh]'} flex items-center justify-center px-4 py-12`}>
      {/* Ambient brand glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-20 left-1/2 h-64 w-[32rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-48 w-64 rounded-full bg-brand/8 blur-3xl" />
        <div className="absolute bottom-10 left-0 h-40 w-56 rounded-full bg-brand/6 blur-3xl" />
      </div>

      <div className="w-full max-w-lg text-center">
        {/* Brand logo */}
        <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-line-subtle bg-surface shadow-lg shadow-brand/5">
          <Image
            src="/logo.png"
            alt="CBN Coop"
            width={56}
            height={56}
            className="h-14 w-14 object-contain"
            priority
          />
        </div>

        {/* Brand name */}
        <p className="text-xs font-semibold uppercase tracking-widest text-brand">CBN Coop</p>

        {/* Error title */}
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-fg">
          {title || headings[context] || headings.root}
        </h1>

        {/* Error message */}
        <p className="mt-3 text-sm leading-relaxed text-muted">
          {message || descriptions[context] || descriptions.root}
        </p>

        {/* Error details (collapsed) */}
        {showDetails && error?.message && (
          <details className="mt-5 rounded-xl border border-line bg-surface/80 p-4 text-left backdrop-blur">
            <summary className="cursor-pointer text-xs font-medium text-muted transition-colors hover:text-fg">
              Technical details
            </summary>
            <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-subtle p-3 font-mono text-xs leading-relaxed text-danger-fg">
              {error.message}
              {error.digest && `\n\nDigest: ${error.digest}`}
            </pre>
          </details>
        )}

        {/* Action buttons */}
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          {reset && (
            <button
              onClick={() => reset()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-7 py-3 text-sm font-semibold text-on-accent shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-hover hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Try again
            </button>
          )}
          {links[0] && (
            <Link
              href={links[0].href}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-line bg-surface px-7 py-3 text-sm font-medium text-fg transition-all duration-200 hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
            >
              {links[0].label}
            </Link>
          )}
        </div>

        {/* Quick links */}
        {links.length > 1 && (
          <div className="mt-8 border-t border-line-subtle pt-6">
            <p className="mb-3 text-xs font-medium text-subtext">Quick links</p>
            <div className="flex flex-wrap justify-center gap-2">
              {links.slice(1).map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-surface/60 px-3 py-1.5 text-xs font-medium text-muted transition-all duration-150 hover:border-brand/30 hover:bg-brand/5 hover:text-brand"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
