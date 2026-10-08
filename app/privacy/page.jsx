// app/privacy/page.jsx — public privacy policy page (is-agentic trust-anchor
// check: /privacy must exist with real content). Server component so it can
// export metadata (canonical + description).

import LandingHeader from '../components/LandingHeader'
import Reveal from '../components/ui/Reveal'

const PRIVACY_NAV = [
  { href: '/#services', label: 'What we do' },
  { href: '/#how', label: 'How it works' },
  { href: '/#why', label: 'Why join' },
  { href: '/#faq', label: 'FAQ' },
]

export const metadata = {
  title: 'Privacy Policy — CBN Coop Seasonal Sales',
  description:
    'How CBN Coop Seasonal Sales collects, uses, shares and protects member data: sign-in identifiers, orders, cookies/local storage, vendors and branch reps, retention and your choices.',
  alternates: {
    canonical: '/privacy',
  },
}

const SECTIONS = [
  {
    title: 'What we collect',
    body: [
      'Account data: your staff ID, name, branch, email address and phone number. Email is used to send one-time sign-in passcodes and order updates.',
      'Order data: items you order during a seasonal cycle, quantities, delivery location and the receipts generated for your orders.',
      'Device data: your browser stores small local items (localStorage) for your theme preference, shopping cart and sign-in session. Standard web server logs record IP address, time and pages requested for security and abuse prevention.',
    ],
  },
  {
    title: 'How we use it',
    body: [
      'To authenticate you (staff ID plus a one-time email passcode), to process and deliver your seasonal orders, to show your order history and receipts, and to respond to support requests you send us.',
      'To let cooperative staff run the operation: administrators approve and deliver orders, and your branch representative sees the orders assigned to your branch so they can fulfil them.',
      'To keep the platform safe: rate limiting, signed session cookies and audit logging of administrative actions.',
    ],
  },
  {
    title: 'Who can see it',
    body: [
      'Inside the cooperative: administrators and your branch representative see the order details needed to fulfil your order. Vendors see only the orders for their own products (name and fulfilment details, not your account credentials).',
      'Infrastructure: the platform is hosted on Supabase (database, authentication and realtime), which processes data on our behalf under its own security standards. We do not sell, rent or trade your personal data with advertisers or third parties.',
    ],
  },
  {
    title: 'Retention and your choices',
    body: [
      'Order and account records are retained for as long as the cooperative needs them for accounting, audits and member service. You can ask us to correct your details or answer any question about your data at any time.',
      'Sessions expire automatically and you can sign out at any time; clearing your browser storage removes the locally stored theme, cart and session items.',
    ],
  },
]

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <LandingHeader navLinks={PRIVACY_NAV} navLabel="Marketing" />

      {/* ============================== HERO ============================== */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16 lg:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              Privacy Policy
            </span>
            <h1 className="mt-4 text-h1 font-bold tracking-tight text-fg">
              How we handle your data.
            </h1>
            <p className="mt-3 text-sm leading-6 text-fg/80 sm:text-base">
              Plain language, no surprises: what CBN Coop Seasonal Sales collects, why we need it,
              who inside the cooperative can see it, and the choices you have. Last updated
              8 October 2026.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ============================== CONTENT ============================== */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-12 lg:px-6 lg:py-16">
          <div className="space-y-5">
            {SECTIONS.map((s) => (
              <Reveal key={s.title}>
                <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                  <h2 className="text-sm font-bold text-fg">{s.title}</h2>
                  <div className="mt-3 space-y-3 text-sm leading-6 text-fg/80">
                    {s.body.map((paragraph) => (
                      <p key={paragraph}>{paragraph}</p>
                    ))}
                  </div>
                </div>
              </Reveal>
            ))}

            {/* Contact */}
            <Reveal>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <h2 className="text-sm font-bold text-fg">Questions or requests</h2>
                <p className="mt-3 text-sm leading-6 text-fg/80">
                  Contact the customer service team at{' '}
                  <a
                    href="mailto:customerservice@cbncoopng.com"
                    className="font-semibold text-brand hover:text-brand-fg"
                  >
                    customerservice@cbncoopng.com
                  </a>
                  , call 09096797982 or 08180578550 (Monday to Friday, 8:00 AM to 4:00 PM), use
                  the live chat button on any page, or reach your branch representative — they are
                  the fastest route for order issues. See the{' '}
                  <a href="/about" className="font-semibold text-brand hover:text-brand-fg">
                    about page
                  </a>{' '}
                  for who runs this platform.
                </p>
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
            <span className="font-semibold text-brand">MitemsHub</span>
          </p>
        </div>
      </footer>
    </div>
  )
}
