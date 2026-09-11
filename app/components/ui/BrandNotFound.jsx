// app/components/ui/BrandNotFound.jsx
// Branded 404 page with the Coop logo, helpful navigation, and contextual links.
import Image from 'next/image'
import Link from 'next/link'

const CONTEXT_LINKS = {
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

export default function BrandNotFound({ context = 'root' }) {
  const links = CONTEXT_LINKS[context] || CONTEXT_LINKS.root

  return (
    <div className="relative min-h-[60vh] overflow-hidden px-4 py-12">
      {/* Ambient brand glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-20 left-1/2 h-64 w-[32rem] -translate-x-1/2 rounded-full bg-brand/10 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-48 w-64 rounded-full bg-brand/8 blur-3xl" />
      </div>

      <div className="mx-auto flex max-w-lg flex-col items-center text-center">
        {/* Brand logo */}
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-line-subtle bg-surface shadow-lg shadow-brand/5">
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

        {/* 404 number */}
        <div className="mt-4 inline-flex items-center gap-2 rounded-2xl bg-brand/10 px-5 py-2">
          <span className="text-4xl font-black tracking-tighter text-brand">404</span>
        </div>

        <h1 className="mt-4 text-2xl font-bold tracking-tight text-fg">Page not found</h1>
        <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          Let&apos;s get you back on track.
        </p>

        {/* Primary action */}
        <div className="mt-7">
          <Link
            href={links[0]?.href || '/'}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-7 py-3 text-sm font-semibold text-on-accent shadow-lg shadow-brand/20 transition-all duration-200 hover:bg-brand-hover hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            {links[0]?.label || 'Go to homepage'}
          </Link>
        </div>

        {/* Quick links */}
        {links.length > 1 && (
          <div className="mt-8 border-t border-line-subtle pt-6">
            <p className="mb-3 text-xs font-medium text-subtext">Or try one of these</p>
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
