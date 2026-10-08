// lib/siteMetadata.js
// Single source of truth for the site's <head> metadata.
// The is-agentic audit flagged missing canonical URL + og:type on the
// homepage, and a weak brand/product title — keeping everything here lets the
// tests assert those signals stay present.

/** Canonical production origin (no trailing slash). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'https://sales.cbncoopng.com').replace(/\/+$/, '')

const TITLE = 'CBN Coop — Seasonal Sales Platform for Food, Exhibition & RAM Orders'
const DESCRIPTION =
  'CBN Coop seasonal sales platform — exhibition, food, RAM and shop modules for members and vendors.'

/** @type {import('next').Metadata} */
export const siteMetadata = {
  // Resolves relative canonical/OG urls against the production origin.
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: {
    icon: '/logo.png?v=4',
    shortcut: '/logo.png?v=4',
    apple: '/logo.png?v=4',
  },
  openGraph: {
    // og:type was a partial-score signal in the audit; every page here is a
    // plain web document, so 'website' is correct app-wide.
    type: 'website',
    title: TITLE,
    description: DESCRIPTION,
    siteName: 'CBN Coop',
    images: [
      {
        url: '/logo.png?v=4',
        width: 101,
        height: 100,
        alt: 'CBN Coop Logo',
      },
    ],
  },
  twitter: {
    card: 'summary',
    images: ['/logo.png?v=4'],
  },
}
