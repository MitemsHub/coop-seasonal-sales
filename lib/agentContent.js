// lib/agentContent.js
// Content negotiation for AI agents (acceptmarkdown.com / is-agentic checks).
//
// A client that *explicitly* sends `Accept: text/markdown` receives Markdown
// instead of HTML: the homepage summary below, and a Markdown 404 body for
// paths that do not exist. middleware.js is the only request-time caller; the
// helpers are pure (and Response-based) so they can be unit-tested.

import { SITE_URL } from './siteMetadata.js'

const MARKDOWN = 'text/markdown'

/**
 * True only when the client explicitly asks for text/markdown.
 * curl's default catch-all Accept (star slash star) must NOT count —
 * otherwise every plain curl request would start receiving Markdown.
 * `text/markdown;q=0` means "not acceptable", so that does not count either.
 */
export function wantsMarkdown(acceptHeader) {
  if (!acceptHeader) return false
  return acceptHeader.split(',').some((entry) => {
    const [type, ...params] = entry.trim().toLowerCase().split(';')
    if (type.trim() !== MARKDOWN) return false
    const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='))
    if (q && Number.parseFloat(q.slice(2)) === 0) return false
    return true
  })
}

// Extensions served from /public (plus build assets). Documents with these
// extensions never take part in negotiation — only HTML-ish routes do.
const STATIC_EXT =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|css|js|mjs|map|txt|xml|json|pdf|woff2?|ttf|otf|eot|mp4|webm|csv|xlsx?)$/i

/** True for static assets (build files and /public files) — pass-through only. */
export function isAssetPath(pathname) {
  if (pathname.startsWith('/_next/')) return true
  const last = pathname.slice(pathname.lastIndexOf('/') + 1)
  return last.includes('.') && STATIC_EXT.test(last)
}

/** Markdown rendering of the homepage, served for `Accept: text/markdown`. */
export const HOMEPAGE_MARKDOWN = `# CBN Coop Seasonal Sales

CBN Coop is a Nigerian cooperative's members-only seasonal sales platform.
During each seasonal cycle, members browse and order **food distribution**,
**RAM (livestock) sales** and **exhibition stock** from cooperative vendors
online, then pick up at their branch — at fair member-only prices.

## What lives on this site

- [Member portal](https://sales.cbncoopng.com/portal): sign in with your staff ID and email OTP, browse the current cycle and place orders.
- [Shop](https://sales.cbncoopng.com/shop): storefront for the items on sale in the active season.
- [Food cycle survey](https://sales.cbncoopng.com/survey): register interest for the next food distribution cycle.
- [About CBN Coop](https://sales.cbncoopng.com/about): who runs this platform and how the seasonal cycle works.
- [Contact & support](https://sales.cbncoopng.com/contact): customer service channels (email, phone, WhatsApp).

## For AI agents

- [llms.txt](https://sales.cbncoopng.com/llms.txt): when to use this site and how to call it.
- [Sitemap](https://sales.cbncoopng.com/sitemap.xml): every public, indexable page.
- [Privacy policy](https://sales.cbncoopng.com/privacy): how member data is handled.

Machine notes: cart, ordering, order history and the rep/vendor/admin tools
require a signed-in member session (staff ID + email OTP) and are not
crawlable. Public pages are read-only.
Customer service: customerservice@cbncoopng.com · 09096797982 · 08180578550
(Mon–Fri, 08:00–16:00 WAT).
`

/**
 * Markdown body for 404 responses (minimum 20 characters, with links to
 * llms.txt/sitemap as the audit requires).
 */
export function notFoundMarkdown(pathname) {
  const path = pathname || '/'
  return `# 404 — Page not found

The path '${path}' does not exist on sales.cbncoopng.com (HTTP 404). It may
have moved, or the link pointing here may be wrong.

## Where to look instead

- [llms.txt](https://sales.cbncoopng.com/llms.txt): agent instructions — when to use this site and how to call it.
- [Sitemap](https://sales.cbncoopng.com/sitemap.xml): every public page on this site.
- [Home](https://sales.cbncoopng.com/): CBN Coop Seasonal Sales.
- [Contact](https://sales.cbncoopng.com/contact): customerservice@cbncoopng.com, 09096797982, 08180578550.
`
}

/**
 * Build the negotiated response. `body: null` for HEAD requests (headers and
 * status only). Content-Type is exactly `text/markdown`, and Vary: Accept
 * tells caches/audits that the response depends on the Accept header.
 */
export function markdownResponse(body, status = 200) {
  return new Response(body ?? null, {
    status,
    headers: {
      'Content-Type': 'text/markdown',
      Vary: 'Accept',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
