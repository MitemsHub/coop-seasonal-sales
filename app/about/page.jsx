// app/about/page.jsx — public trust/identity page (is-agentic audit checks
// /about exists with real content). Server component so it can export
// metadata (canonical + description) and render without client JS.

import LandingHeader from '../components/LandingHeader'
import Reveal from '../components/ui/Reveal'

// Marketing anchors point back to the landing page's sections.
const ABOUT_NAV = [
  { href: '/#services', label: 'What we do' },
  { href: '/#how', label: 'How it works' },
  { href: '/#why', label: 'Why join' },
  { href: '/#faq', label: 'FAQ' },
]

export const metadata = {
  title: 'About CBN Coop — Seasonal Sales Platform',
  description:
    'Who runs the CBN Coop Seasonal Sales platform: the cooperative, the seasonal food/RAM/exhibition modules, how a cycle works, and how members, vendors and branch reps take part.',
  alternates: {
    canonical: '/about',
  },
}

const MODULES = [
  {
    title: 'Food distribution',
    body: 'Members reserve food staples for the current cycle from the shared catalogue and receive them through their branch.',
  },
  {
    title: 'RAM sales',
    body: 'Livestock orders are placed during the RAM cycle, with delivery locations and quantities captured per member.',
  },
  {
    title: 'Coop Exhibition',
    body: 'Seasonal exhibition stock from cooperative vendors — clothing, fabrics, home decor, groceries and more — sold to members at fair prices.',
  },
  {
    title: 'Member shop',
    body: 'The in-season storefront where members browse live inventory, track orders and download receipts.',
  },
]

const STEPS = [
  {
    title: '1. Sign in',
    body: 'Members sign in with their staff ID and a one-time passcode sent to their email — no shared passwords.',
  },
  {
    title: '2. Order in the open cycle',
    body: 'Each seasonal cycle opens for a limited window. Members add items to a cart and place the order before the cycle closes.',
  },
  {
    title: '3. Pick up at your branch',
    body: 'Orders are consolidated per branch. Your branch representative confirms delivery or pickup, and the status is visible in your order history.',
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-canvas text-fg">
      <LandingHeader navLinks={ABOUT_NAV} navLabel="Marketing" />

      {/* ============================== HERO ============================== */}
      <section className="border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:py-16 lg:px-6">
          <Reveal className="mx-auto max-w-2xl text-center">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand">
              About CBN Coop
            </span>
            <h1 className="mt-4 text-h1 font-bold tracking-tight text-fg">
              A cooperative&apos;s own seasonal sales platform.
            </h1>
            <p className="mt-3 text-sm leading-6 text-fg/80 sm:text-base">
              CBN Coop Seasonal Sales is the online ordering system the cooperative runs for its
              members — fair, member-only prices, ordering from your branch, no middlemen.
            </p>
          </Reveal>
        </div>
      </section>

      {/* ============================== CONTENT ============================== */}
      <section className="bg-canvas">
        <div className="mx-auto max-w-7xl px-4 py-12 lg:px-6 lg:py-16">
          <div className="space-y-5">
            {/* Who we are */}
            <Reveal>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <h2 className="text-sm font-bold text-fg">Who we are</h2>
                <div className="mt-3 space-y-3 text-sm leading-6 text-fg/80">
                  <p>
                    CBN Coop is a member-owned cooperative that moves goods the cooperative way:
                    members pool their demand, the cooperative buys at scale, and everyone pays a
                    fair, member-only price. The cooperative currently serves members across 37
                    branches nationwide, including Abuja, Lagos and more.
                  </p>
                  <p>
                    This website — CBN Coop Seasonal Sales — is the digital side of that operation.
                    It is owned and operated for CBN Coop members: it is not a public marketplace,
                    and accounts are tied to real staff identities verified by email one-time
                    passcodes. Support runs Monday to Friday, 8:00 AM to 4:00 PM.
                  </p>
                </div>
              </div>
            </Reveal>

            {/* Modules */}
            <Reveal>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <h2 className="text-sm font-bold text-fg">What the platform does</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  {MODULES.map((m) => (
                    <div key={m.title} className="rounded-xl border border-line bg-canvas p-4">
                      <h3 className="text-sm font-semibold text-fg">{m.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-fg/75">{m.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* How a cycle works */}
            <Reveal>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <h2 className="text-sm font-bold text-fg">How a seasonal cycle works</h2>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  {STEPS.map((s) => (
                    <div key={s.title} className="rounded-xl border border-line bg-canvas p-4">
                      <h3 className="text-sm font-semibold text-fg">{s.title}</h3>
                      <p className="mt-1.5 text-xs leading-5 text-fg/75">{s.body}</p>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {/* Who it's for + contact */}
            <Reveal>
              <div className="rounded-2xl border border-line bg-surface p-5 shadow-xs sm:p-6">
                <h2 className="text-sm font-bold text-fg">Who takes part</h2>
                <div className="mt-3 space-y-3 text-sm leading-6 text-fg/80">
                  <p>
                    <span className="font-semibold text-fg">Members</span> browse and order during
                    each open cycle and follow their order history.{' '}
                    <span className="font-semibold text-fg">Vendors</span> list their catalogue,
                    fulfil orders and manage invoices through the vendor portal.{' '}
                    <span className="font-semibold text-fg">Branch representatives</span> confirm
                    and deliver orders for their branch, and <span className="font-semibold text-fg">cooperative staff</span> run the admin
                    dashboard that approves, delivers and reports on every cycle.
                  </p>
                  <p>
                    Questions? Email{' '}
                    <a
                      href="mailto:customerservice@cbncoopng.com"
                      className="font-semibold text-brand hover:text-brand-fg"
                    >
                      customerservice@cbncoopng.com
                    </a>{' '}
                    or call 09096797982 / 08180578550. See the{' '}
                    <a href="/privacy" className="font-semibold text-brand hover:text-brand-fg">
                      privacy policy
                    </a>{' '}
                    for how member data is handled.
                  </p>
                </div>
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
