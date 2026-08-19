// app/components/ui/Breadcrumbs.jsx
// Clickable trail for deep pages — every segment links up a level; the last
// segment is the current page and renders as plain emphasized text. Segments
// whose href matches the current pathname render as text (no self-link).
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Breadcrumbs({ items = [], className = '', label = 'Breadcrumb' }) {
  const pathname = usePathname()

  if (!items.length) return null

  return (
    <nav
      aria-label={label}
      className={`flex min-w-0 items-center gap-1.5 overflow-hidden text-chips text-muted sm:text-caption ${className}`}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const hrefPath = item.href ? item.href.split('?')[0] : null
        const isCurrentPage = hrefPath === pathname
        const clickable = Boolean(!isLast && !isCurrentPage && item.href)

        return (
          <span key={i} className="flex min-w-0 items-center gap-1.5">
            {i > 0 && (
              <span className="shrink-0 text-subtext" aria-hidden="true">
                ›
              </span>
            )}
            {clickable ? (
              <Link
                href={item.href}
                className="truncate rounded transition-colors duration-150 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
              >
                {item.label}
              </Link>
            ) : (
              <span
                className={`truncate ${isLast ? 'font-medium text-fg' : 'text-subtext'}`}
                aria-current={isLast ? 'page' : undefined}
              >
                {item.label}
              </span>
            )}
          </span>
        )
      })}
    </nav>
  )
}
